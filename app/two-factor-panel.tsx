"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Copy from "lucide-react/icons/copy";
import ShieldCheck from "lucide-react/icons/shield-check";
import { qrSvg } from "./qr-code";

async function post<T>(payload: Record<string, unknown>) {
  const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

/** Desliga a verificação de outra pessoa (administrador; para quem perdeu o celular e os códigos). */
export async function resetMemberTwoFactor(memberId: number) {
  await post({ action: "totpReset", memberId });
}

/** Meu perfil: ligar a verificação em duas etapas (QR code + código), ver os códigos de recuperação e desligar. */
export default function TwoFactorPanel() {
  const [status, setStatus] = useState<{ enabled: boolean; recoveryLeft: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setStatus(await post<{ enabled: boolean; recoveryLeft: number }>({ action: "totpStatus" })); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível carregar."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const qr = useMemo(() => { if (!setup) return ""; try { return qrSvg(setup.uri, 4); } catch { return ""; } }, [setup]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }

  return <div className="two-factor-panel full">
    <div><strong><ShieldCheck size={15} /> Verificação em duas etapas</strong><small>Além da senha, o Portal pede um código que muda a cada 30 segundos no seu celular. Mesmo que alguém descubra sua senha, não entra.</small></div>

    {codes ? <div className="two-factor-codes">
      <p><b>Guarde estes códigos de recuperação</b> (num lugar seguro, fora do celular). Cada um serve uma vez para entrar se você perder o celular. Eles não aparecem de novo.</p>
      <ul>{codes.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
      <div className="two-factor-actions"><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(codes.join("\n")).catch(() => undefined)}><Copy size={14} /> Copiar os códigos</button><button type="button" className="primary-button" onClick={() => setCodes(null)}>Já guardei</button></div>
    </div> : status === null ? (error ? null : <div className="loading-list"><span /></div>) : status.enabled ? <>
      <p className="two-factor-on">✓ Ligada. {status.recoveryLeft} {status.recoveryLeft === 1 ? "código de recuperação restante" : "códigos de recuperação restantes"}.</p>
      {disabling ? <div className="two-factor-confirm">
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={11} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Código do aplicativo" aria-label="Código do aplicativo para desligar" />
        <button type="button" className="secondary-button" disabled={busy || code.trim().length < 6} onClick={() => run(async () => { await post({ action: "totpDisable", code }); setCode(""); setDisabling(false); await load(); })}>Desligar</button>
        <button type="button" className="link-button" onClick={() => { setDisabling(false); setCode(""); }}>Cancelar</button>
      </div> : <button type="button" className="link-button danger" onClick={() => setDisabling(true)}>Desligar a verificação</button>}
    </> : setup ? <div className="two-factor-setup">
      <ol>
        <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator ou outro).</li>
        <li>No aplicativo, toque em “adicionar” e leia este QR code{qr ? "" : " (ou digite a chave abaixo)"}.</li>
        <li>Digite o código de 6 números que aparecer.</li>
      </ol>
      <div className="two-factor-qr">
        {qr && <span className="two-factor-qr-image" dangerouslySetInnerHTML={{ __html: qr }} />}
        <div><small>Não consegue ler o QR code? Digite esta chave no aplicativo:</small><code className="two-factor-secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></div>
      </div>
      <div className="two-factor-confirm">
        <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" aria-label="Código de 6 números" />
        <button type="button" className="primary-button" disabled={busy || code.length !== 6} onClick={() => run(async () => { const result = await post<{ recoveryCodes: string[] }>({ action: "totpEnable", code }); setCodes(result.recoveryCodes); setSetup(null); setCode(""); await load(); })}>Ligar</button>
        <button type="button" className="link-button" onClick={() => { setSetup(null); setCode(""); }}>Cancelar</button>
      </div>
    </div> : <button type="button" className="secondary-button" disabled={busy} onClick={() => run(async () => setSetup(await post<{ secret: string; uri: string }>({ action: "totpSetup" })))}>Ligar a verificação em duas etapas</button>}
    {error && <p className="modal-error">{error}</p>}
  </div>;
}

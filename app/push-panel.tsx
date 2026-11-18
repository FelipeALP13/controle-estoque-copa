"use client";

import { useCallback, useEffect, useState } from "react";
import BellRing from "lucide-react/icons/bell-ring";
import Smartphone from "lucide-react/icons/smartphone";
import Trash2 from "lucide-react/icons/trash-2";
import { PUSH_ON_KEY } from "./notify-sound";

type Device = { id: number; device: string; createdAt: string; lastOkAt: string | null; endpointEnd: string };

async function call<T>(payload: Record<string, unknown>) {
  const response = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

const toKey = (base64: string) => Uint8Array.from(atob(base64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

/** Meu perfil: receber os avisos do sino no celular/computador, mesmo com o Portal fechado. */
export default function PushPanel() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [here, setHere] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canUse, setCanUse] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/push", { cache: "no-store" });
      const data = await response.json() as { publicKey?: string; devices?: Device[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar.");
      setDevices(data.devices ?? []);
      setPublicKey(data.publicKey ?? "");
      if (supported()) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        setHere(subscription?.endpoint ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { setCanUse(supported()); void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const thisDevice = here ? devices?.find((device) => here.endsWith(device.endpointEnd)) ?? null : null;

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }

  const enable = () => run(async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("O navegador bloqueou os avisos. Libere nas configurações do site (ícone do cadeado) e tente de novo.");
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
    await call({ action: "subscribe", endpoint: subscription.endpoint });
    try { window.localStorage.setItem(PUSH_ON_KEY, "1"); } catch { /* sem armazenamento */ }
    await load();
    setNotice("Pronto! Este aparelho vai receber os avisos do sino.");
  });

  const disable = () => run(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) { await call({ action: "unsubscribe", endpoint: subscription.endpoint }); await subscription.unsubscribe().catch(() => undefined); }
    try { window.localStorage.removeItem(PUSH_ON_KEY); } catch { /* sem armazenamento */ }
    await load();
  });

  return <div className="push-panel full">
    <div><strong><BellRing size={15} /> Avisos no celular</strong><small>Receba os avisos do sino (chamado novo, menção, lembrete…) como notificação do celular ou do computador, mesmo com o Portal fechado. O texto só aparece para quem está logado.</small></div>
    {canUse === false ? <p className="muted">{isIos() && !installed() ? "No iPhone, primeiro instale o Portal: no Safari toque em Compartilhar → “Adicionar à Tela de Início”, abra pelo ícone e ligue aqui." : "Este navegador não recebe avisos fora da página. Use o Chrome, o Edge ou o Safari atualizado."}</p>
      : thisDevice ? <div className="push-actions"><span className="push-on">✓ Ligado neste aparelho</span><button type="button" className="secondary-button" disabled={busy} onClick={() => run(async () => { const result = await call<{ sent: number; total: number }>({ action: "test" }); setNotice(result.sent ? "Teste enviado. O aviso deve aparecer em alguns segundos." : "O serviço de avisos não aceitou o envio. Tente desligar e ligar de novo."); })}>Enviar um teste</button><button type="button" className="link-button danger" disabled={busy} onClick={disable}>Desligar neste aparelho</button></div>
      : <button type="button" className="secondary-button" disabled={busy || !publicKey} onClick={enable}><Smartphone size={14} /> Ligar neste aparelho</button>}
    {devices && devices.length > 0 && <ul className="push-devices">{devices.map((device) => <li key={device.id}><Smartphone size={13} /><span>{device.device || "Aparelho"}{thisDevice?.id === device.id ? " (este)" : ""}</span><small>{device.lastOkAt ? "recebeu avisos" : "ainda sem avisos"}</small>
      {thisDevice?.id !== device.id && <button type="button" className="task-drawer-icon" disabled={busy} onClick={() => run(async () => { await call({ action: "unsubscribe", deviceId: device.id }); await load(); })} aria-label={`Parar avisos em ${device.device}`} title="Parar os avisos neste aparelho"><Trash2 size={13} /></button>}</li>)}</ul>}
    {notice && <p className="sessions-notice">{notice}</p>}
    {error && <p className="modal-error">{error}</p>}
  </div>;
}

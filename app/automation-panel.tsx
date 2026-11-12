"use client";

import { useCallback, useEffect, useState } from "react";
import BellRing from "lucide-react/icons/bell-ring";
import Copy from "lucide-react/icons/copy";
import Play from "lucide-react/icons/play";
import Send from "lucide-react/icons/send";
import Timer from "lucide-react/icons/timer";

type Snapshot = { cronConfigured: boolean; cronLastRun: string | null; cronLastResult: { errors?: string[]; jira?: { name: string; created: number; error: string | null }[]; stock?: { sent?: boolean; reason?: string }; late?: { alerted?: number } } | null; teamsConfigured: boolean; stockAlert: boolean; lateAlert: boolean; alertHour: number; stockLastDay: string | null; portalUrl: string | null };

async function post<T>(payload: Record<string, unknown>) {
  const response = await fetch("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

function ago(value: string | null) {
  if (!value) return "nunca";
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 1) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `há ${hours} h` : `há ${Math.round(hours / 24)} dias`;
}

/** Automação (administrador): agendador externo e alertas no Teams. */
export default function AutomationPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [form, setForm] = useState({ webhook: "", alertHour: 9, stockAlert: true, lateAlert: false });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/automation", { cache: "no-store" });
      const json = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
      setData(json);
      setForm((current) => ({ ...current, alertHour: json.alertHour, stockAlert: json.stockAlert, lateAlert: json.lateAlert }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); } finally { setBusy(""); }
  }

  const generate = () => run("key", async () => {
    if (data?.cronConfigured && !window.confirm("Gerar uma chave nova? A chave atual do GitHub para de funcionar até você trocar o segredo PORTAL_CRON_KEY.")) return;
    const result = await post<Snapshot & { key: string }>({ action: "generateCronKey" });
    setNewKey(result.key);
    setData(result);
  });

  const saveTeams = () => run("teams", async () => {
    const result = await post<Snapshot>({ action: "saveTeams", ...form });
    setData(result);
    setForm((current) => ({ ...current, webhook: "" }));
    setNotice("Configuração do Teams salva.");
  });

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice("Copiado."); } catch { setNotice("Selecione e copie o texto manualmente."); }
  };

  if (!data) return error ? <p className="modal-error">{error}</p> : <div className="loading-list"><span /></div>;
  const last = data.cronLastResult;
  const portal = data.portalUrl ?? (typeof window !== "undefined" ? window.location.origin : "");

  return <section className="report-card automation">
    <div className="report-card-head"><div><h3>Automação</h3><p>Rotinas que rodam sozinhas: busca no Jira, alerta diário de estoque baixo e aviso de chamados que passaram do prazo.</p></div></div>
    {error && <p className="modal-error">{error}</p>}
    {notice && !error && <p className="jira-notice">{notice}</p>}

    <div className="automation-grid">
      <div className="automation-box">
        <h4><Timer size={15} /> Agendador (GitHub)</h4>
        <p className="automation-status">{data.cronConfigured ? <>Chave configurada · última execução <b>{ago(data.cronLastRun)}</b></> : "Ainda não configurado. Sem ele, as rotinas só rodam enquanto alguém está com o Portal aberto."}</p>
        {last && <ul className="automation-last">
          {(last.jira ?? []).map((entry) => <li key={entry.name}>{entry.name}: {entry.error ? <em>{entry.error}</em> : `${entry.created} chamado(s) novo(s)`}</li>)}
          {last.stock && <li>Estoque: {last.stock.sent ? "alerta enviado" : last.stock.reason}</li>}
          {last.late && <li>Atrasos: {last.late.alerted ?? 0} aviso(s)</li>}
          {(last.errors ?? []).map((message) => <li key={message}><em>{message}</em></li>)}
        </ul>}
        {newKey && <div className="automation-key">
          <p><b>Copie agora:</b> esta chave não aparece de novo. No GitHub, vá em <b>Settings → Secrets and variables → Actions → New repository secret</b> e crie:</p>
          <label>PORTAL_URL<span><code>{portal}</code><button type="button" onClick={() => copy(portal)} aria-label="Copiar endereço"><Copy size={13} /></button></span></label>
          <label>PORTAL_CRON_KEY<span><code>{newKey}</code><button type="button" onClick={() => copy(newKey)} aria-label="Copiar chave"><Copy size={13} /></button></span></label>
          <small>O arquivo do agendador já está no repositório (.github/workflows/agendador.yml). Depois de criar os dois segredos, ele roda sozinho a cada 10 minutos.</small>
        </div>}
        <div className="automation-actions">
          <button className="secondary-button" onClick={generate} disabled={Boolean(busy)}>{data.cronConfigured ? "Gerar chave nova" : "Gerar chave do agendador"}</button>
          <button className="secondary-button" onClick={() => run("run", async () => { const result = await post<Snapshot & { result: { errors: string[] } }>({ action: "runNow" }); setData(result); setNotice(result.result.errors.length ? `Rodou com avisos: ${result.result.errors.join(" · ")}` : "Rotinas executadas agora."); })} disabled={Boolean(busy)}><Play size={14} /> {busy === "run" ? "Rodando..." : "Rodar agora"}</button>
        </div>
      </div>

      <div className="automation-box">
        <h4><BellRing size={15} /> Alertas no Microsoft Teams</h4>
        <p className="automation-status">{data.teamsConfigured ? "Canal do Teams conectado." : "Nenhum canal conectado."} {data.stockLastDay && <>Último alerta de estoque: <b>{data.stockLastDay.split("-").reverse().join("/")}</b>.</>}</p>
        <label className="automation-field"><span>Link do Workflow do canal {data.teamsConfigured && <em>(guardado; cole só para trocar)</em>}</span><input type="password" autoComplete="off" value={form.webhook} onChange={(event) => setForm({ ...form, webhook: event.target.value })} placeholder="https://...logic.azure.com/workflows/..." /></label>
        <details className="automation-help"><summary>Como pegar o link no Teams</summary><ol><li>No canal do Teams, clique em <b>…</b> → <b>Workflows</b>.</li><li>Escolha <b>“Postar em um canal quando uma solicitação de webhook for recebida”</b>.</li><li>Confirme o canal e copie o link que aparece no final.</li></ol></details>
        <label className="checkbox-line"><input type="checkbox" checked={form.stockAlert} onChange={(event) => setForm({ ...form, stockAlert: event.target.checked })} /> <span>Alerta diário de estoque baixo, a partir das</span> <select value={form.alertHour} onChange={(event) => setForm({ ...form, alertHour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}h</option>)}</select></label>
        <label className="checkbox-line"><input type="checkbox" checked={form.lateAlert} onChange={(event) => setForm({ ...form, lateAlert: event.target.checked })} /> <span>Também avisar no Teams quando um chamado passa do prazo (os líderes sempre recebem no sino)</span></label>
        <div className="automation-actions">
          <button className="primary-button" onClick={saveTeams} disabled={Boolean(busy)}>{busy === "teams" ? "Salvando..." : "Salvar"}</button>
          <button className="secondary-button" onClick={() => run("test", async () => { await post({ action: "testTeams" }); setNotice("Mensagem de teste enviada. Confira o canal do Teams."); })} disabled={Boolean(busy) || !data.teamsConfigured}><Send size={14} /> Enviar teste</button>
          <button className="secondary-button" onClick={() => run("stock", async () => { const result = await post<{ result: { sent: boolean; items?: number } }>({ action: "sendStockNow" }); setNotice(`Alerta de estoque enviado (${result.result.items ?? 0} item(ns)).`); await load(); })} disabled={Boolean(busy) || !data.teamsConfigured}>Enviar estoque agora</button>
        </div>
      </div>
    </div>
  </section>;
}

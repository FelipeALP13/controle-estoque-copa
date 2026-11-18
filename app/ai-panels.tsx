"use client";

import { useEffect, useState } from "react";
import KeyRound from "lucide-react/icons/key-round";
import RefreshCw from "lucide-react/icons/refresh-cw";
import Sparkles from "lucide-react/icons/sparkles";
import { SUMMARY_MIN_EVENTS } from "./ai-assist";

type Status = { configured: boolean; model: string; models: { id: string; label: string }[]; keyTail?: string | null; testUrl?: string | null; dev?: boolean };

async function call<T>(payload: Record<string, unknown>) {
  const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível usar o assistente.");
  return data;
}

let statusCache: Promise<Status | null> | null = null;
function useAiStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    statusCache ??= fetch("/api/ai", { cache: "no-store" }).then((response) => (response.ok ? response.json() as Promise<Status> : null)).catch(() => null);
    let alive = true;
    void statusCache.then((value) => { if (alive) setStatus(value); });
    return () => { alive = false; };
  }, []);
  return status;
}

/** No chamado: resumo do que aconteceu (chamado longo) e sugestão de resposta a partir da base e de chamados parecidos. */
export function TicketAssistant({ ticketId, eventCount, canReply, onUseReply }: { ticketId: number; eventCount: number; canReply: boolean; onUseReply: (text: string) => void }) {
  const status = useAiStatus();
  const [summary, setSummary] = useState<{ text: string; cached: boolean } | null>(null);
  const [reply, setReply] = useState<{ text: string; sources: { articles: { id: number; title: string }[]; tickets: { id: number; code: string; title: string }[] } } | null>(null);
  const [busy, setBusy] = useState<"summary" | "reply" | null>(null);
  const [error, setError] = useState("");
  if (!status?.configured) return null;
  const long = eventCount >= SUMMARY_MIN_EVENTS;
  if (!long && !canReply) return null;

  async function run(kind: "summary" | "reply", force = false) {
    setBusy(kind); setError("");
    try {
      if (kind === "summary") setSummary(await call<{ text: string; cached: boolean }>({ action: "summary", ticketId, force }));
      else setReply(await call({ action: "reply", ticketId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível usar o assistente.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="ai-assistant">
    <div className="ai-assistant-bar"><Sparkles size={14} /><strong>Assistente</strong>
      {long && <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void run("summary")}>{busy === "summary" ? "Resumindo…" : "Resumir o chamado"}</button>}
      {canReply && <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void run("reply")}>{busy === "reply" ? "Pensando…" : "Sugerir resposta"}</button>}
    </div>
    {summary && <div className="ai-result"><small>O que aconteceu até agora{summary.cached ? " (resumo guardado)" : ""}</small><p>{summary.text}</p>
      <button type="button" className="link-button" disabled={busy !== null} onClick={() => void run("summary", true)}><RefreshCw size={12} /> Fazer de novo</button></div>}
    {reply && <div className="ai-result"><small>Sugestão de resposta (confira antes de enviar)</small><p>{reply.text}</p>
      <div className="ai-result-actions"><button type="button" className="primary-button" onClick={() => onUseReply(reply.text.split(/\n\s*Fontes:/)[0].trim())}>Usar no comentário</button><button type="button" className="link-button" onClick={() => setReply(null)}>Descartar</button></div></div>}
    {error && <p className="modal-error">{error}</p>}
    <p className="ai-note">Gerado por IA (Claude) a partir deste chamado, da base de conhecimento e de chamados parecidos. Pode errar: revise antes de usar.</p>
  </div>;
}

/** Administração: chave da Anthropic e modelo do assistente. */
export function AiSettingsPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => {
    const response = await fetch("/api/ai", { cache: "no-store" });
    if (response.ok) { const data = await response.json() as Status; setStatus(data); setTestUrl(data.testUrl ?? ""); }
    statusCache = null;
  };
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, []);
  async function run(payload: Record<string, unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await call(payload); await load(); setNotice(done); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); } finally { setBusy(false); }
  }
  if (!status) return null;
  return <section className="report-card ai-settings">
    <div className="report-card-head"><div><h3><Sparkles size={16} /> Assistente de chamados (IA)</h3><p>Resumo de chamados longos e sugestão de resposta com o Claude. A chave fica criptografada e nunca volta para a tela. Cada uso consome créditos da sua conta da Anthropic.</p></div></div>
    <div className="ai-settings-form">
      <label><span>Chave da Anthropic {status.keyTail && <em>(atual: {status.keyTail})</em>}</span><input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder={status.configured ? "Cole uma chave nova para trocar" : "sk-ant-..."} /></label>
      <button className="primary-button" disabled={busy || !key.trim()} onClick={() => void run({ action: "saveKey", key }, "Chave salva.").then(() => setKey(""))}><KeyRound size={14} /> Salvar chave</button>
      {status.configured && <button className="link-button danger" disabled={busy} onClick={() => { if (window.confirm("Remover a chave? O assistente some dos chamados.")) void run({ action: "removeKey" }, "Chave removida."); }}>Remover</button>}
    </div>
    <div className="ai-settings-form">
      <label><span>Modelo</span><select value={status.model} disabled={busy} onChange={(event) => void run({ action: "saveModel", model: event.target.value }, "Modelo salvo.")}>{status.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
    </div>
    {status.dev && <div className="ai-settings-form"><label><span>Servidor de teste (só no computador de desenvolvimento)</span><input value={testUrl} onChange={(event) => setTestUrl(event.target.value)} placeholder="http://127.0.0.1:7071/v1/messages" /></label><button className="secondary-button" disabled={busy} onClick={() => void run({ action: "setTestUrl", url: testUrl.trim() }, testUrl.trim() ? "Usando o servidor de teste." : "Usando a API de verdade.")}>Aplicar</button></div>}
    {notice && <p className="sessions-notice">{notice}</p>}
    {error && <p className="modal-error">{error}</p>}
  </section>;
}

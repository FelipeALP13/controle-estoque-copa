"use client";

import { useCallback, useEffect, useState } from "react";
import Copy from "lucide-react/icons/copy";
import Download from "lucide-react/icons/download";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import KeyRound from "lucide-react/icons/key-round";
import Plus from "lucide-react/icons/plus";
import X from "lucide-react/icons/x";
import { EXPORT_DATASETS, type ExportDataset } from "./export-data";

type Key = { id: number; name: string; kind: string; prefix: string; createdByName: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

const when = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";

async function send(payload: Record<string, unknown>) {
  const response = await fetch("/api/integrations/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({})) as { error?: string; key?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

/** Administração: baixar os dados em Excel/CSV e ligar o Power BI (ou o Excel) com uma chave só de leitura. */
export default function ExportPanel() {
  const [dataset, setDataset] = useState<ExportDataset>("tickets");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/keys", { cache: "no-store" });
      const data = await response.json() as { keys?: Key[]; error?: string };
      if (!response.ok || !data.keys) throw new Error(data.error || "Não foi possível carregar as chaves.");
      setKeys(data.keys.filter((key) => key.kind === "export"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as chaves.");
      setKeys([]);
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { setOrigin(window.location.origin); void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const query = (format: string) => `/api/export?dataset=${dataset}&format=${format}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const active = (keys ?? []).filter((key) => !key.revokedAt);
  async function copy(text: string, label: string) { try { await navigator.clipboard.writeText(text); setCopied(label); window.setTimeout(() => setCopied(""), 2000); } catch { setCopied(""); } }

  return <section className="report-card export-panel">
    <div className="report-card-head"><div><h3><FileSpreadsheet size={16} /> Exportar dados</h3><p>Baixe os dados para analisar no Excel ou ligue o Power BI para atualizar sozinho. Só administradores.</p></div></div>
    <div className="export-form">
      <label><span>O que exportar</span><select value={dataset} onChange={(event) => setDataset(event.target.value as ExportDataset)}>{EXPORT_DATASETS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></label>
      <label><span>De <em>opcional</em></span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>Até <em>opcional</em></span><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
      <div className="export-actions"><a className="primary-button" href={query("xlsx")} download><Download size={15} /> Excel</a><a className="secondary-button" href={query("csv")} download><Download size={15} /> CSV</a></div>
    </div>
    <p className="muted">{EXPORT_DATASETS.find((entry) => entry.key === dataset)?.hint} Sem datas, vai tudo (até 20 mil linhas).</p>

    <div className="export-bi">
      <div className="export-bi-head"><div><h4><KeyRound size={14} /> Power BI e Excel conectados</h4><p>Crie uma chave só de leitura. No Power BI: <b>Obter dados → Web → Avançado</b>, cole o endereço e, em cabeçalhos, <code>Authorization</code> = <code>Bearer</code> + a chave. A chave não altera nada no Portal.</p></div>
        <button className="secondary-button" onClick={async () => { setError(""); try { const data = await send({ action: "createKey", kind: "export", name: "Power BI" }); setNewKey(data.key ?? null); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível criar a chave."); } }}><Plus size={15} /> Nova chave de leitura</button></div>
      {newKey && <div className="integration-new-key" role="status"><KeyRound size={16} /><div><strong>Copie a chave agora: ela não aparece de novo.</strong><code>{newKey}</code></div>
        <div className="integration-new-actions"><button className="primary-button" onClick={() => void copy(newKey, "key")}><Copy size={14} /> {copied === "key" ? "Copiada" : "Copiar"}</button><button className="secondary-button" onClick={() => setNewKey(null)} aria-label="Fechar"><X size={14} /></button></div></div>}
      <ul className="export-urls">{EXPORT_DATASETS.map((entry) => { const url = `${origin}/api/export?dataset=${entry.key}&format=json`; return <li key={entry.key}><span>{entry.label}</span><code>{url}</code><button className="task-drawer-icon" onClick={() => void copy(url, entry.key)} aria-label={`Copiar endereço de ${entry.label}`} title="Copiar endereço">{copied === entry.key ? "✓" : <Copy size={13} />}</button></li>; })}</ul>
      {error && <p className="modal-error">{error}</p>}
      {keys && active.length > 0 && <ul className="integration-list">{active.map((key) => <li key={key.id}><div><strong>{key.name}</strong> <code>{key.prefix}</code><small>último uso: {when(key.lastUsedAt)} · criada por {key.createdByName}</small></div>
        <button className="secondary-button danger" onClick={async () => { if (!window.confirm(`Revogar a chave "${key.name}"? O Power BI que usa esta chave para de atualizar.`)) return; try { await send({ action: "revokeKey", id: key.id }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível revogar."); } }}>Revogar</button></li>)}</ul>}
    </div>
  </section>;
}

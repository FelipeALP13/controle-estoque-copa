"use client";

import { useCallback, useEffect, useState } from "react";
import Bot from "lucide-react/icons/bot";
import Copy from "lucide-react/icons/copy";
import KeyRound from "lucide-react/icons/key-round";
import Plus from "lucide-react/icons/plus";
import X from "lucide-react/icons/x";

type Key = { id: number; name: string; prefix: string; teamId: number | null; teamName: string | null; kbTag: string; createdByName: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; articles: number };
type Team = { id: number; name: string };

const when = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";

async function send(payload: Record<string, unknown>) {
  const response = await fetch("/api/integrations/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({})) as { error?: string; key?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

/** Administração: chaves para o agente N1 do AtendeChat consultar a base e abrir chamados. */
export function IntegrationsPanel() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "AtendeChat", teamId: "", kbTag: "n1" });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/keys", { cache: "no-store" });
      const data = await response.json() as { keys?: Key[]; teams?: Team[]; error?: string };
      if (!response.ok || !data.keys) throw new Error(data.error || "Não foi possível carregar as integrações.");
      setKeys(data.keys);
      setTeams(data.teams ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as integrações.");
      setKeys([]);
    }
  }, []);
  useEffect(() => { const first = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(first); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const data = await send({ action: "createKey", name: form.name, teamId: Number(form.teamId), kbTag: form.kbTag });
      setNewKey(data.key ?? null);
      setCopied(false);
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a chave.");
    }
  }

  async function revoke(key: Key) {
    if (!window.confirm(`Revogar a chave "${key.name}"? O AtendeChat que usa esta chave para de consultar a base e de abrir chamados na hora.`)) return;
    setError("");
    try { await send({ action: "revokeKey", id: key.id }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível revogar."); }
  }

  async function copy() {
    if (!newKey) return;
    try { await navigator.clipboard.writeText(newKey); setCopied(true); } catch { setCopied(false); }
  }

  const active = (keys ?? []).filter((key) => !key.revokedAt);
  const revoked = (keys ?? []).filter((key) => key.revokedAt);

  return <section className="report-card integrations-panel">
    <div className="report-card-head report-card-toolbar">
      <div><h3><Bot size={16} /> Agente N1 do AtendeChat</h3><p>Chave para o N1 buscar respostas na Base de conhecimento e abrir chamados aqui. Ele só lê os artigos com a etiqueta escolhida; o resto da base continua interno.</p></div>
      <div className="report-actions"><button className="secondary-button" onClick={() => { setCreating((value) => !value); setNewKey(null); }}><Plus size={15} /> Nova chave</button></div>
    </div>

    {newKey && <div className="integration-new-key" role="status">
      <KeyRound size={16} />
      <div>
        <strong>Copie a chave agora: ela não aparece de novo.</strong>
        <p>Cole no AtendeChat, na configuração do agente N1 (campo &quot;Chave do Portal&quot;).</p>
        <code>{newKey}</code>
      </div>
      <div className="integration-new-actions">
        <button className="primary-button" onClick={copy}><Copy size={14} /> {copied ? "Copiada" : "Copiar"}</button>
        <button className="secondary-button" onClick={() => setNewKey(null)} aria-label="Fechar"><X size={14} /></button>
      </div>
    </div>}

    {creating && <form className="integration-form" onSubmit={create}>
      <label><span>Nome</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} required /></label>
      <label><span>Time que recebe os chamados</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })} required><option value="">Escolha…</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label><span>Etiqueta dos artigos liberados</span><input value={form.kbTag} onChange={(event) => setForm({ ...form, kbTag: event.target.value })} maxLength={24} /></label>
      <div className="integration-form-actions"><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancelar</button><button className="primary-button">Criar chave</button></div>
    </form>}

    {error && <p className="modal-error">{error}</p>}

    {!keys ? <div className="loading-list"><span /></div> : active.length === 0 && !creating ? <p className="muted">Nenhuma chave ativa. Crie uma para ligar o AtendeChat.</p> : <ul className="integration-list">
      {active.map((key) => <li key={key.id}>
        <div><strong>{key.name}</strong> <code>{key.prefix}</code>
          <small>Chamados para {key.teamName ?? "nenhum time"} · lê {key.articles} {key.articles === 1 ? "artigo" : "artigos"} com a etiqueta &quot;{key.kbTag}&quot; · último uso: {when(key.lastUsedAt)} · criada por {key.createdByName}</small>
        </div>
        <button className="secondary-button danger" onClick={() => revoke(key)}>Revogar</button>
      </li>)}
    </ul>}
    {revoked.length > 0 && <p className="muted integration-revoked">{revoked.length} {revoked.length === 1 ? "chave revogada" : "chaves revogadas"}: {revoked.map((key) => key.name).join(", ")}.</p>}
  </section>;
}

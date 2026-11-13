"use client";

import { useCallback, useEffect, useState } from "react";
import ExternalLink from "lucide-react/icons/external-link";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import RefreshCw from "lucide-react/icons/refresh-cw";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { relativeTime } from "./tasks-view";
import { TICKETS_CHANGED } from "./use-jira-sync";

type Connection = { id: number; name: string; baseUrl: string; email: string; active: boolean; teamId: number | null; lastSyncAt: string | null; cursorAt: string | null; lastError: string | null; hasToken: boolean };
type Project = { connectionId: number; projectKey: string; projectName: string; clientId: number | null; enabled: boolean };
type Named = { id: number; name: string; active?: boolean };
type Data = { connections: Connection[]; projects: Project[]; clients: Named[]; teams: Named[] };
type SyncResult = { created: number; updated: number; comments: number; error: string | null; more?: boolean };

async function post<T>(payload: Record<string, unknown>) {
  const response = await fetch("/api/jira", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Configuração das contas do Jira: endereço, chave de API e quais projetos trazer, de qual cliente. */
export default function JiraSettings({ onClose, onSynced }: { onClose: () => void; onSynced: () => Promise<void> }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Connection | "new" | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/jira", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function syncNow(connection: Connection) {
    setBusy(connection.id); setError(""); setNotice("");
    try {
      const total = { created: 0, updated: 0, comments: 0 };
      for (let round = 0; round < 20; round += 1) {
        const { result } = await post<{ result: SyncResult & { skipped?: boolean } }>({ action: "syncNow", connectionId: connection.id });
        if (result.error) throw new Error(result.error);
        if (result.skipped) { setNotice("Uma busca já está em andamento nesta conta. Tente de novo em instantes."); break; }
        total.created += result.created; total.updated += result.updated; total.comments += result.comments;
        if (!result.more) { setNotice(`${connection.name}: ${total.created} chamado${total.created === 1 ? "" : "s"} novo${total.created === 1 ? "" : "s"}, ${total.updated} atualizado${total.updated === 1 ? "" : "s"}, ${total.comments} comentário${total.comments === 1 ? "" : "s"}.`); break; }
      }
      window.dispatchEvent(new Event(TICKETS_CHANGED));
      await onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível buscar.");
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function saveProject(project: Project, changes: Partial<Project>) {
    if (!data) return;
    const next = { ...project, ...changes };
    // Ao ligar um projeto sem cliente, sugere o cliente de nome parecido.
    if (changes.enabled && !next.clientId) next.clientId = data.clients.find((client) => fold(client.name) && (fold(project.projectName).includes(fold(client.name)) || fold(client.name).includes(fold(project.projectName))))?.id ?? null;
    setData({ ...data, projects: data.projects.map((row) => row.connectionId === project.connectionId && row.projectKey === project.projectKey ? next : row) });
    try {
      await post({ action: "saveProject", connectionId: project.connectionId, projectKey: project.projectKey, enabled: next.enabled, clientId: next.clientId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      await load();
    }
  }

  async function remove(connection: Connection) {
    if (!window.confirm(`Remover a conta “${connection.name}”? Os chamados que já vieram dela continuam no Portal, mas param de ser atualizados.`)) return;
    try { await post({ action: "deleteConnection", connectionId: connection.id }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível remover."); }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal jira-modal">
    <div className="modal-head"><div><h2>Chamados do Jira</h2><p>Chamados abertos nos projetos marcados aparecem sozinhos na fila do Suporte, com o cliente certo. O Portal busca a cada 2 minutos enquanto alguém da equipe está com ele aberto.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="jira-body">
      {error && <p className="modal-error">{error}</p>}
      {notice && !error && <p className="jira-notice">{notice}</p>}
      {!data ? <div className="loading-list"><span /><span /></div> : <>
        {data.connections.map((connection) => {
          const projects = data.projects.filter((project) => project.connectionId === connection.id);
          const enabled = projects.filter((project) => project.enabled).length;
          return <section key={connection.id} className={`jira-account ${connection.lastError ? "failing" : ""}`}>
            <header>
              <div><strong>{connection.name}</strong><a href={connection.baseUrl} target="_blank" rel="noopener noreferrer">{connection.baseUrl.replace(/^https?:\/\//, "")} <ExternalLink size={11} /></a><small>{connection.email} · {enabled} de {projects.length} projeto{projects.length === 1 ? "" : "s"} marcado{enabled === 1 ? "" : "s"}{connection.lastSyncAt ? ` · última busca ${relativeTime(connection.lastSyncAt)}` : " · ainda não buscou"}{!connection.active && " · pausada"}</small></div>
              <button className="secondary-button" disabled={busy !== null || !enabled} onClick={() => syncNow(connection)} title={enabled ? "Buscar agora" : "Marque ao menos um projeto"}><RefreshCw size={14} className={busy === connection.id ? "spin" : ""} /> {busy === connection.id ? "Buscando..." : "Buscar agora"}</button>
              <button className="person-edit" onClick={() => setEditing(connection)} aria-label={`Editar ${connection.name}`} title="Editar conta"><Pencil size={14} /></button>
              <button className="person-edit" onClick={() => remove(connection)} aria-label={`Remover ${connection.name}`} title="Remover conta"><Trash2 size={14} /></button>
            </header>
            {connection.lastError && <p className="jira-error">{connection.lastError}</p>}
            {projects.length ? <table className="jira-projects">
              <thead><tr><th>Trazer</th><th>Projeto no Jira</th><th>Cliente no Portal</th></tr></thead>
              <tbody>{projects.map((project) => <tr key={project.projectKey} className={project.enabled ? "on" : ""}>
                <td><input type="checkbox" checked={project.enabled} onChange={(event) => void saveProject(project, { enabled: event.target.checked })} aria-label={`Trazer chamados de ${project.projectKey}`} /></td>
                <td><b>{project.projectKey}</b> {project.projectName}</td>
                <td><select value={project.clientId ?? ""} onChange={(event) => void saveProject(project, { clientId: event.target.value ? Number(event.target.value) : null })}><option value="">Usar o nome do projeto</option>{data.clients.filter((client) => client.active !== false || client.id === project.clientId).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></td>
              </tr>)}</tbody>
            </table> : <p className="muted">Nenhum projeto visível para este usuário do Jira. Confira as permissões dele lá.</p>}
          </section>;
        })}
        {!data.connections.length && <div className="jira-help">
          <strong>Como conectar uma conta</strong>
          <ol>
            <li>Entre no Jira com o usuário que vai ler os chamados (pode ser um usuário só de leitura).</li>
            <li>Abra <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">id.atlassian.com → Segurança → Tokens de API</a> e crie uma chave.</li>
            <li>Clique em “Adicionar conta”, cole o endereço do Jira, o e-mail desse usuário e a chave.</li>
            <li>Marque os projetos que devem virar chamados e escolha o cliente de cada um.</li>
          </ol>
          <small>Repita para cada uma das contas (inclusive a do cliente onde vocês só recebem demandas: basta o usuário de vocês ter acesso aos projetos).</small>
        </div>}
        <button className="primary-button jira-add" onClick={() => setEditing("new")}><Plus size={15} /> Adicionar conta do Jira</button>
      </>}
    </div>
    {editing && data && <ConnectionForm value={editing === "new" ? null : editing} teams={data.teams} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); setNotice(message); setError(""); await load(); }} />}
  </div></div>;
}

function ConnectionForm({ value, teams, onClose, onSaved }: { value: Connection | null; teams: Named[]; onClose: () => void; onSaved: (message: string) => void }) {
  const support = teams.find((team) => fold(team.name) === "suporte");
  const [form, setForm] = useState({ name: value?.name ?? "", baseUrl: value?.baseUrl ?? "", email: value?.email ?? "", apiToken: "", teamId: String(value?.teamId ?? support?.id ?? ""), active: value?.active ?? true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await post<{ user: string; projects: number }>({ action: "saveConnection", connectionId: value?.id, ...form, teamId: form.teamId ? Number(form.teamId) : null });
      onSaved(`Conectado como ${result.user}. ${result.projects} projeto${result.projects === 1 ? "" : "s"} encontrado${result.projects === 1 ? "" : "s"}: marque quais trazer.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      setSaving(false);
    }
  }

  return <div className="modal-layer nested"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit} autoComplete="off">
    <div className="modal-head"><div><h2>{value ? "Editar conta" : "Adicionar conta"}</h2><p>Ao salvar, o Portal testa a conexão com o Jira. A chave fica guardada no servidor e não aparece mais na tela.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Nome</span><input autoFocus required maxLength={60} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Jira Dr. Hoje" /></label>
      <label className="full"><span>Endereço do Jira</span><input required value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://suaempresa.atlassian.net" /></label>
      <label><span>E-mail do usuário</span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="quem gerou a chave" /></label>
      <label><span>Chave de API</span><input type="password" required={!value?.hasToken} value={form.apiToken} onChange={(event) => setForm({ ...form, apiToken: event.target.value })} placeholder={value?.hasToken ? "Guardada (preencha só para trocar)" : "Cole a chave aqui"} autoComplete="new-password" /></label>
      <label><span>Fila no Portal</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Suporte (padrão)</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label className="checkbox-line"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> <span>Buscar chamados desta conta</span></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Testando conexão..." : "Salvar e testar"}</button></div>
  </form></div>;
}

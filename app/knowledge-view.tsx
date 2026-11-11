"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BookOpen from "lucide-react/icons/book-open";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { fold, MAX_KB_BODY, searchArticles } from "./knowledge";
import { relativeTime, TeamChip } from "./tasks-view";
import { ticketCode } from "./tickets";

export type Article = { id: number; title: string; body: string; clientId: number | null; teamId: number | null; tags: string; ticketId: number | null; createdByName: string; updatedByName: string; createdAt: string; updatedAt: string; canDelete: boolean };
type Client = { id: number; name: string; active: boolean };
type Team = { id: number; name: string; color: string };
type Data = { articles: Article[]; clients: Client[]; teams: Team[]; me: { id: number; canEdit: boolean; isAdmin: boolean } };
/** Rascunho vindo de um chamado resolvido ("Salvar solução na base"). */
export type ArticleDraft = { title: string; body: string; ticketId: number; teamId: number | null; clientName: string };

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; article?: Article };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

function snippet(text: string, size = 180) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > size ? `${flat.slice(0, size - 1).trimEnd()}…` : flat;
}

export default function KnowledgeView({ openRequest = null, draft = null, onRequestHandled, onOpenTicket }: { openRequest?: number | null; draft?: ArticleDraft | null; onRequestHandled?: () => void; onOpenTicket: (ticketId: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [client, setClient] = useState("");
  const [team, setTeam] = useState("");
  const [reading, setReading] = useState<number | null>(null);
  const [editing, setEditing] = useState<Article | "new" | ArticleDraft | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar a base.");
      setData(json);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a base.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  // Pedido vindo de um chamado: abrir um artigo ou começar um a partir da solução.
  useEffect(() => {
    if (!data || (!openRequest && !draft)) return;
    const timer = window.setTimeout(() => {
      if (draft) setEditing(draft);
      else if (openRequest) { if (data.articles.some((article) => article.id === openRequest)) setReading(openRequest); else setError("Este artigo não existe mais."); }
      onRequestHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data, openRequest, draft, onRequestHandled]);

  const clientsById = useMemo(() => new Map((data?.clients ?? []).map((entry) => [entry.id, entry.name])), [data]);
  const teamsById = useMemo(() => new Map((data?.teams ?? []).map((entry) => [entry.id, entry])), [data]);
  const visible = useMemo(() => {
    const list = (data?.articles ?? []).filter((article) => (!client || article.clientId === Number(client)) && (!team || article.teamId === Number(team)));
    return searchArticles(list.map((article) => ({ ...article, client: article.clientId ? clientsById.get(article.clientId) ?? "" : "" })), search);
  }, [data, client, team, search, clientsById]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div>;
  const open = data.articles.find((article) => article.id === reading) ?? null;
  const usedClients = data.clients.filter((entry) => data.articles.some((article) => article.clientId === entry.id));

  return <div className="kb-page">
    <div className="tasks-toolbar">
      <label className="tasks-search kb-search"><Search size={14} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Descreva o problema: ex. boleto não aparece, senha autorizador" /></label>
      {usedClients.length > 0 && <select aria-label="Filtrar por cliente" value={client} onChange={(event) => setClient(event.target.value)}><option value="">Todos os clientes</option>{usedClients.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>}
      {data.teams.length > 0 && <select aria-label="Filtrar por time" value={team} onChange={(event) => setTeam(event.target.value)}><option value="">Todos os times</option>{data.teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>}
      {data.me.canEdit && <button className="primary-button tasks-new" onClick={() => setEditing("new")}><Plus size={16} /> Novo artigo</button>}
    </div>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    {!data.articles.length ? <div className="empty-state"><span><BookOpen /></span><h3>A base ainda está vazia</h3><p>Registre aqui as soluções que se repetem: o passo a passo que resolveu, para quem atender da próxima vez. Nos chamados resolvidos aparece o botão “Salvar solução na base”.</p>{data.me.canEdit && <div><button className="primary-button" onClick={() => setEditing("new")}><Plus size={16} /> Escrever o primeiro artigo</button></div>}</div>
      : visible.length ? <div className="kb-list">
        <p className="kb-count">{visible.length} de {data.articles.length} artigo{data.articles.length === 1 ? "" : "s"}</p>
        {visible.map((article) => <button key={article.id} className="kb-card" onClick={() => setReading(article.id)}>
          <strong>{article.title}</strong>
          <p>{snippet(article.body)}</p>
          <span className="kb-meta">
            {article.clientId && <span className="kb-client">{clientsById.get(article.clientId)}</span>}
            {article.teamId && teamsById.get(article.teamId) && <TeamChip team={teamsById.get(article.teamId)!} />}
            {article.tags && article.tags.split(", ").map((tag) => <span key={tag} className="kb-tag">#{tag}</span>)}
            <small>Atualizado {relativeTime(article.updatedAt)} por {article.updatedByName}</small>
          </span>
        </button>)}
      </div> : <div className="empty-state compact"><Search /><h3>Nada encontrado</h3><p>Tente outras palavras. Se resolver um caso novo, registre a solução para a próxima vez.</p></div>}

    {open && <div className="task-drawer-layer">
      <button className="backdrop" onClick={() => setReading(null)} aria-label="Fechar artigo" />
      <aside className="task-drawer kb-reader" role="dialog" aria-label={open.title}>
        <header className="task-drawer-head">
          <span className="task-drawer-created">Escrito por {open.createdByName} · atualizado {relativeTime(open.updatedAt)} por {open.updatedByName}</span>
          {data.me.canEdit && <button className="task-drawer-icon" onClick={() => setEditing(open)} aria-label="Editar artigo" title="Editar"><Pencil size={15} /></button>}
          {open.canDelete && <button className="task-drawer-icon danger" onClick={async () => { if (!window.confirm(`Excluir o artigo “${open.title}”? Esta ação não pode ser desfeita.`)) return; try { await post({ action: "deleteArticle", articleId: open.id }); setReading(null); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível excluir."); } }} aria-label="Excluir artigo" title="Excluir"><Trash2 size={15} /></button>}
          <button className="task-drawer-icon" onClick={() => setReading(null)} aria-label="Fechar" title="Fechar"><X size={16} /></button>
        </header>
        <div className="kb-reader-body">
          <h2>{open.title}</h2>
          <p className="kb-meta">
            {open.clientId && <span className="kb-client">{clientsById.get(open.clientId)}</span>}
            {open.teamId && teamsById.get(open.teamId) && <TeamChip team={teamsById.get(open.teamId)!} />}
            {open.tags && open.tags.split(", ").map((tag) => <span key={tag} className="kb-tag">#{tag}</span>)}
            {open.ticketId && <button className="link-button" onClick={() => onOpenTicket(open.ticketId!)}>Veio do chamado {ticketCode(open.ticketId)}</button>}
          </p>
          <div className="kb-text">{open.body}</div>
        </div>
      </aside>
    </div>}

    {editing && <ArticleModal value={editing} clients={data.clients} teams={data.teams} onClose={() => setEditing(null)} onSaved={async (article) => { setEditing(null); await load(); setReading(article.id); }} />}
  </div>;
}

function ArticleModal({ value, clients, teams, onClose, onSaved }: { value: Article | "new" | ArticleDraft; clients: Client[]; teams: Team[]; onClose: () => void; onSaved: (article: Article) => void }) {
  const existing = value !== "new" && "id" in value ? value : null;
  const draft = value !== "new" && !("id" in value) ? value : null;
  const draftClient = draft?.clientName ? clients.find((entry) => fold(entry.name) === fold(draft.clientName.trim())) : undefined;
  const [form, setForm] = useState({
    title: existing?.title ?? draft?.title ?? "",
    body: existing?.body ?? draft?.body ?? "",
    clientId: String(existing?.clientId ?? draftClient?.id ?? ""),
    teamId: String(existing?.teamId ?? draft?.teamId ?? ""),
    tags: existing?.tags ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await post({ action: "saveArticle", articleId: existing?.id, ticketId: draft?.ticketId, ...form });
      if (result.article) onSaved({ ...result.article, canDelete: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      setSaving(false);
    }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal kb-modal" onSubmit={submit}>
    <div className="modal-head"><div><p className="eyebrow">BASE DE CONHECIMENTO</p><h2>{existing ? "Editar artigo" : "Novo artigo"}</h2><p>{draft ? `A partir do chamado ${ticketCode(draft.ticketId)}. Revise e escreva o passo a passo que resolveu.` : "Escreva como quem vai atender da próxima vez: o sintoma, a causa e o passo a passo."}</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Título (o problema, como o cliente descreve)</span><input autoFocus required maxLength={140} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Boleto não aparece no site do cliente" /></label>
      <label><span>Cliente (opcional)</span><select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Vale para todos</option>{clients.filter((entry) => entry.active || String(entry.id) === form.clientId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label><span>Time (opcional)</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Qualquer time</option>{teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label className="full"><span>Etiquetas (separe por vírgula)</span><input maxLength={240} value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="Ex.: boleto, financeiro, remessa" /></label>
      <label className="full"><span>Solução</span><textarea required rows={12} maxLength={MAX_KB_BODY} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder={"Sintoma: ...\nCausa: ...\nComo resolver:\n1. ...\n2. ..."} /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.title.trim() || form.body.trim().length < 10}>{saving ? "Salvando..." : "Salvar artigo"}</button></div>
  </form></div>;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CircleCheck from "lucide-react/icons/circle-check";
import Hand from "lucide-react/icons/hand";
import LifeBuoy from "lucide-react/icons/life-buoy";
import ListTodo from "lucide-react/icons/list-todo";
import MessageSquare from "lucide-react/icons/message-square";
import Plus from "lucide-react/icons/plus";
import RotateCcw from "lucide-react/icons/rotate-ccw";
import Search from "lucide-react/icons/search";
import Send from "lucide-react/icons/send";
import Timer from "lucide-react/icons/timer";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { splitMentions } from "./notifications";
import { taskCode } from "./tasks";
import { Avatar, MentionTextarea, relativeTime, TeamChip } from "./tasks-view";
import Download from "lucide-react/icons/download";
import BookOpen from "lucide-react/icons/book-open";
import ExternalLink from "lucide-react/icons/external-link";
import Plug from "lucide-react/icons/plug";
import JiraSettings from "./jira-settings";
import { TICKETS_CHANGED } from "./use-jira-sync";
import { relatedArticles, type SearchableArticle } from "./knowledge";
import type { ArticleDraft } from "./knowledge-view";
import { downloadXlsx } from "./xlsx-writer";
import { canHandleTicket, compareTickets, describeTicketEvent, formatMinutes, isActiveTicket, isTicketLate, parseStoredDate, resolutionHours, resolutionStatus, slaStatus, ticketCode, ticketStatuses, ticketStatusLabels, ticketTypeLabels, ticketTypes, ticketUrgencies, ticketUrgencyLabels, type TicketEventKind, type TicketStatus, type TicketType, type TicketUrgency } from "./tickets";

type Ticket = {
  id: number; title: string; description: string; type: TicketType; urgency: TicketUrgency; status: TicketStatus; client: string;
  teamId: number | null; requesterId: number | null; requesterName: string; assigneeId: number | null; taskId: number | null;
  firstResponseAt: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string; commentCount: number;
  source: "portal" | "jira"; externalKey: string | null; externalUrl: string | null; externalStatus: string | null;
};
type Person = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
type Team = { id: number; name: string; color: string };
type Viewer = { id: number; isAdmin: boolean; canEdit: boolean; teamIds: number[] };
type TicketEvent = { id: number; kind: TicketEventKind; body: string; actorId: number | null; actorName: string; createdAt: string; canDelete: boolean };
type Data = { tickets: Ticket[]; members: Person[]; teams: Team[]; me: Viewer };
type Scope = "queue" | "requested" | "assigned" | "all";

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; ticket?: Ticket; task?: { id: number } };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

function UrgencyBadge({ urgency }: { urgency: TicketUrgency }) {
  return <span className={`urgency-badge ${urgency}`}>{ticketUrgencyLabels[urgency]}</span>;
}

function StatusPill({ status }: { status: TicketStatus }) {
  return <span className={`ticket-status ${status}`}>{ticketStatusLabels[status]}</span>;
}

function SlaBadge({ ticket }: { ticket: Ticket }) {
  if (!isActiveTicket(ticket.status)) return <span className="sla-badge done">{ticket.resolvedAt ? `Resolvido ${relativeTime(ticket.resolvedAt)}` : "Encerrado"}</span>;
  const sla = slaStatus(ticket);
  // Já respondido: passa a valer o prazo de solução.
  if (sla.state === "met" || sla.state === "late") {
    const solve = resolutionStatus(ticket);
    if (!solve) return null;
    return <span className={`sla-badge ${solve.state}`} title="Prazo de solução"><Timer size={11} />{solve.state === "breached" ? `Solução atrasada ${formatMinutes(-solve.minutesLeft)}` : `Resolver em ${formatMinutes(solve.minutesLeft)}`}</span>;
  }
  const text = sla.state === "breached" ? `Atrasado ${formatMinutes(-sla.minutesLeft)}` : `Responder em ${formatMinutes(sla.minutesLeft)}`;
  return <span className={`sla-badge ${sla.state}`} title="Prazo de primeira resposta"><Timer size={11} />{text}</span>;
}

export default function TicketsView({ openRequest = null, onOpenRequestHandled, onOpenTask, onOpenArticle, onSaveSolution }: { openRequest?: number | null; onOpenRequestHandled?: () => void; onOpenTask: (taskId: number) => void; onOpenArticle: (articleId: number) => void; onSaveSolution: (draft: ArticleDraft) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<Scope | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "closed" | "all">("active");
  const [teamFilter, setTeamFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [jiraOpen, setJiraOpen] = useState(false);
  const retried = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tickets", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar os chamados.");
      setData(json);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os chamados.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20000);
    // Chamados novos do Jira: recarrega na hora.
    const onJira = () => { void load(); };
    window.addEventListener(TICKETS_CHANGED, onJira);
    return () => { window.clearTimeout(first); window.clearInterval(interval); window.removeEventListener(TICKETS_CHANGED, onJira); };
  }, [load]);

  useEffect(() => {
    if (!openRequest || !data) return;
    const timer = window.setTimeout(() => {
      if (data.tickets.some((ticket) => ticket.id === openRequest)) setOpenId(openRequest);
      else if (retried.current !== openRequest) { retried.current = openRequest; void load(); return; }
      else setError("Este chamado não existe mais.");
      retried.current = null;
      onOpenRequestHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openRequest, data, onOpenRequestHandled, load]);

  const effectiveScope: Scope = scope ?? (data?.me.teamIds.length ? "queue" : "requested");
  const teamsById = useMemo(() => new Map((data?.teams ?? []).map((team) => [team.id, team])), [data]);
  const peopleById = useMemo(() => new Map((data?.members ?? []).map((person) => [person.id, person])), [data]);

  const inScope = useMemo(() => {
    if (!data) return [];
    return data.tickets.filter((ticket) => {
      if (effectiveScope === "queue" && (ticket.teamId === null || !data.me.teamIds.includes(ticket.teamId))) return false;
      if (effectiveScope === "requested" && ticket.requesterId !== data.me.id) return false;
      if (effectiveScope === "assigned" && ticket.assigneeId !== data.me.id) return false;
      if (teamFilter && ticket.teamId !== Number(teamFilter)) return false;
      return true;
    });
  }, [data, effectiveScope, teamFilter]);

  const visible = useMemo(() => {
    const query = fold(search.trim());
    return inScope.filter((ticket) => {
      if (statusFilter === "active" && !isActiveTicket(ticket.status)) return false;
      if (statusFilter === "closed" && isActiveTicket(ticket.status)) return false;
      return !query || fold(`${ticketCode(ticket.id)} ${ticket.externalKey ?? ""} ${ticket.title} ${ticket.client} ${ticket.requesterName}`).includes(query);
    }).sort(compareTickets);
  }, [inScope, statusFilter, search]);

  const active = inScope.filter((ticket) => isActiveTicket(ticket.status));
  const stats = {
    open: active.filter((ticket) => ticket.status === "open").length,
    progress: active.filter((ticket) => ticket.status === "in_progress").length,
    waiting: active.filter((ticket) => ticket.status === "waiting").length,
    late: active.filter((ticket) => isTicketLate(ticket)).length,
  };

  async function update(ticketId: number, changes: Record<string, unknown>) {
    try {
      const result = await post({ action: "updateTicket", ticketId, ...changes });
      if (result.ticket) setData((current) => current && { ...current, tickets: current.tickets.map((ticket) => ticket.id === ticketId ? { ...ticket, ...result.ticket } : ticket) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  }

  // Exporta os chamados que estão na tela (mesmo escopo, time, situação e busca).
  function exportExcel() {
    if (!data) return;
    const stamp = (value: string | null) => value ? parseStoredDate(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const hoursBetween = (from: string, to: string | null) => to ? Math.round(((parseStoredDate(to).getTime() - parseStoredDate(from).getTime()) / 3600000) * 10) / 10 : null;
    const slaLabel = { ok: "No prazo (aguardando)", warning: "Perto do prazo", breached: "Atrasado (sem resposta)", met: "Respondido no prazo", late: "Respondido com atraso" };
    const solveLabels = { ok: "No prazo", warning: "Perto do prazo", breached: "Atrasado (sem solução)", met: "Resolvido no prazo", late: "Resolvido com atraso" };
    const solveLabel = (ticket: Ticket) => { const state = resolutionStatus(ticket)?.state; return state ? solveLabels[state] : "Cancelado"; };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    downloadXlsx(`chamados-${today}.xlsx`, [
      {
        name: "Chamados",
        columns: [
          { header: "Código", width: 9 }, { header: "Jira", width: 11 }, { header: "Título", width: 46 }, { header: "Tipo", width: 11 }, { header: "Urgência", width: 10 }, { header: "Status", width: 15 },
          { header: "Cliente", width: 20 }, { header: "Time", width: 16 }, { header: "Solicitante", width: 20 }, { header: "Responsável", width: 20 },
          { header: "Aberto em", width: 17 }, { header: "1ª resposta em", width: 17 }, { header: "Horas até 1ª resposta", type: "number", width: 19 }, { header: "Prazo de 1ª resposta", width: 24 },
          { header: "Resolvido em", width: 17 }, { header: "Horas até resolver", type: "number", width: 17 }, { header: "Prazo de solução", width: 24 }, { header: "Demanda ligada", width: 14 }, { header: "Comentários", type: "number", width: 12 }, { header: "Descrição", width: 50 },
        ],
        rows: visible.map((ticket) => [
          ticketCode(ticket.id), ticket.externalKey ?? "", ticket.title, ticketTypeLabels[ticket.type], ticketUrgencyLabels[ticket.urgency], ticketStatusLabels[ticket.status],
          ticket.client, ticket.teamId ? teamsById.get(ticket.teamId)?.name ?? "" : "", ticket.requesterName, ticket.assigneeId ? peopleById.get(ticket.assigneeId)?.name ?? "" : "",
          stamp(ticket.createdAt), stamp(ticket.firstResponseAt), hoursBetween(ticket.createdAt, ticket.firstResponseAt), slaLabel[slaStatus(ticket).state],
          stamp(ticket.resolvedAt), hoursBetween(ticket.createdAt, ticket.resolvedAt), solveLabel(ticket),ticket.taskId ? taskCode(ticket.taskId) : "", ticket.commentCount, ticket.description,
        ]),
      },
      {
        name: "Filtros",
        columns: [{ header: "Filtro", width: 20 }, { header: "Valor", width: 40 }],
        rows: [
          ["Exportado em", new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
          ["Chamados no arquivo", `${visible.length}`],
          ["Quais", scopes.find((entry) => entry.key === effectiveScope)?.label ?? ""],
          ["Time", teamFilter ? teamsById.get(Number(teamFilter))?.name ?? "" : "Todos os times"],
          ["Situação", statusFilter === "active" ? "Em aberto" : statusFilter === "closed" ? "Encerrados" : "Todos"],
          ["Busca", search.trim() || "—"],
        ],
      },
    ]);
  }

  const openTicket = data?.tickets.find((ticket) => ticket.id === openId) ?? null;
  const scopes: { key: Scope; label: string; show: boolean }[] = [
    { key: "queue", label: "Fila do meu time", show: Boolean(data?.me.teamIds.length) },
    { key: "requested", label: "Abertos por mim", show: true },
    { key: "assigned", label: "Atribuídos a mim", show: true },
    { key: "all", label: "Todos", show: true },
  ];

  return <div className="tickets-page">
    <div className="tasks-toolbar">
      <div className="tasks-scope" role="group" aria-label="Quais chamados">
        {scopes.filter((entry) => entry.show).map((entry) => <button key={entry.key} className={effectiveScope === entry.key ? "active" : ""} aria-pressed={effectiveScope === entry.key} onClick={() => setScope(entry.key)}>{entry.label}</button>)}
      </div>
      <label className="tasks-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, código ou cliente" /></label>
      {(data?.teams.length ?? 0) > 0 && <select aria-label="Filtrar por time" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="">Todos os times</option>{data?.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>}
      <select aria-label="Situação" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="active">Em aberto</option><option value="closed">Encerrados</option><option value="all">Todos</option></select>
      {data?.me.isAdmin && <button className="secondary-button" onClick={() => setJiraOpen(true)} title="Trazer chamados das contas do Jira"><Plug size={15} /> Jira</button>}
      {data && <button className="secondary-button" onClick={exportExcel} disabled={!visible.length} title="Baixa em Excel os chamados que estão na tela, com os filtros aplicados"><Download size={15} /> Exportar Excel</button>}
      {data?.me.canEdit && <button className="primary-button tasks-new" onClick={() => setCreating(true)}><Plus size={16} /> Abrir chamado</button>}
    </div>

    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    {!data ? <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div> : <>
      <div className="ticket-stats">
        <article><small>Abertos</small><strong>{stats.open}</strong><p>Aguardando alguém assumir</p></article>
        <article><small>Em atendimento</small><strong>{stats.progress}</strong><p>Com alguém trabalhando</p></article>
        <article><small>Aguardando</small><strong>{stats.waiting}</strong><p>Esperando retorno</p></article>
        <article className={stats.late ? "late" : ""}><small>Fora do prazo</small><strong>{stats.late}</strong><p>Sem resposta ou sem solução no prazo</p></article>
      </div>

      {visible.length === 0 ? <div className="empty-state"><span><LifeBuoy /></span><h3>{data.tickets.length ? "Nenhum chamado aqui" : "Nenhum chamado ainda"}</h3><p>{data.tickets.length ? "Troque a fila, o filtro de situação ou a busca." : "Quando alguém precisar de outro time, é só abrir um chamado. Ele cai direto na fila do time."}</p>{data.me.canEdit && !data.tickets.length && <div><button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> Abrir chamado</button></div>}</div> : (
        <div className="ticket-list">
          {visible.map((ticket) => {
            const team = ticket.teamId ? teamsById.get(ticket.teamId) : null;
            return <button key={ticket.id} className={`ticket-row ${isActiveTicket(ticket.status) ? "" : "closed"}`} onClick={() => setOpenId(ticket.id)}>
              <UrgencyBadge urgency={ticket.urgency} />
              <span className="ticket-main">
                <span className="ticket-title"><span className="task-code">{ticketCode(ticket.id)}</span>{ticket.externalKey && <span className="jira-badge" title={`Veio do Jira: ${ticket.externalKey}${ticket.externalStatus ? ` (${ticket.externalStatus})` : ""}`}>{ticket.externalKey}</span>}<strong>{ticket.title}</strong></span>
                <span className="ticket-sub">{ticketTypeLabels[ticket.type]}{ticket.client && ` · ${ticket.client}`} · por {ticket.requesterName}{ticket.commentCount > 0 && <span className="task-comments"><MessageSquare size={11} />{ticket.commentCount}</span>}</span>
              </span>
              <span className="ticket-meta">
                {team && <TeamChip team={team} />}
                <SlaBadge ticket={ticket} />
                <StatusPill status={ticket.status} />
                <Avatar member={ticket.assigneeId ? peopleById.get(ticket.assigneeId) : null} />
              </span>
            </button>;
          })}
        </div>
      )}
    </>}

    {jiraOpen && <JiraSettings onClose={() => setJiraOpen(false)} onSynced={load} />}
    {creating && data && <NewTicketModal teams={data.teams} defaultTeamId={teamFilter ? Number(teamFilter) : null} onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); setStatusFilter("active"); await load(); setOpenId(id); }} />}
    {openTicket && data && <TicketDrawer key={openTicket.id} ticket={openTicket} data={data} onClose={() => setOpenId(null)} onUpdate={(changes) => update(openTicket.id, changes)} onReload={load} onOpenTask={onOpenTask} onOpenArticle={onOpenArticle} onSaveSolution={onSaveSolution} />}
  </div>;
}

function NewTicketModal({ teams, defaultTeamId, onClose, onCreated }: { teams: Team[]; defaultTeamId: number | null; onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState(defaultTeamId ? String(defaultTeamId) : "");
  const [type, setType] = useState<TicketType>("question");
  const [urgency, setUrgency] = useState<TicketUrgency>("normal");
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await post({ action: "createTicket", title, teamId: teamId ? Number(teamId) : null, type, urgency, client, description });
      if (result.ticket) onCreated(result.ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir o chamado.");
      setSaving(false);
    }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><p className="eyebrow">CHAMADOS</p><h2>Abrir chamado</h2><p>O chamado cai na fila do time escolhido, e todos do time são avisados.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>O que você precisa?</span><input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Cliente não consegue emitir nota fiscal" /></label>
      {teams.length > 0 && <label><span>Para qual time?</span><select required value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="" disabled>Escolha o time</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
      <label><span>Tipo</span><select value={type} onChange={(event) => setType(event.target.value as TicketType)}>{ticketTypes.map((value) => <option key={value} value={value}>{ticketTypeLabels[value]}</option>)}</select></label>
      <label><span>Urgência</span><select value={urgency} onChange={(event) => setUrgency(event.target.value as TicketUrgency)}>{ticketUrgencies.map((value) => <option key={value} value={value}>{ticketUrgencyLabels[value]}</option>)}</select><small>{{ critical: "Primeira resposta em até 2 h.", high: "Primeira resposta em até 8 h.", normal: "Primeira resposta em até 24 h.", low: "Primeira resposta em até 72 h." }[urgency]}</small></label>
      <label><span>Cliente afetado <em>opcional</em></span><input maxLength={80} value={client} onChange={(event) => setClient(event.target.value)} placeholder="Ex.: Clínica São Lucas" /></label>
      <label className="full"><span>Detalhes</span><textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Passo a passo, mensagem de erro, prints ou links que ajudem o time a resolver." /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !title.trim() || (teams.length > 0 && !teamId)}>{saving ? "Abrindo..." : "Abrir chamado"}</button></div>
  </form></div>;
}

// Artigos da base para sugerir nos chamados (carregados uma vez por minuto, no máximo).
let articlesCache: { at: number; promise: Promise<SearchableArticle[]> } | null = null;
function loadArticles() {
  if (articlesCache && Date.now() - articlesCache.at < 60000) return articlesCache.promise;
  const promise = fetch("/api/knowledge", { cache: "no-store" })
    .then(async (response) => response.ok ? ((await response.json()) as { articles: SearchableArticle[] }).articles.map((article) => ({ ...article, client: "" })) : [])
    .catch(() => [] as SearchableArticle[]);
  articlesCache = { at: Date.now(), promise };
  return promise;
}

function TicketDrawer({ ticket, data, onClose, onUpdate, onReload, onOpenTask, onOpenArticle, onSaveSolution }: { ticket: Ticket; data: Data; onClose: () => void; onUpdate: (changes: Record<string, unknown>) => Promise<void>; onReload: () => Promise<void>; onOpenTask: (taskId: number) => void; onOpenArticle: (articleId: number) => void; onSaveSolution: (draft: ArticleDraft) => void }) {
  const [related, setRelated] = useState<SearchableArticle[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadArticles().then((articles) => { if (!cancelled) setRelated(relatedArticles(articles, `${ticket.title} ${ticket.client}`)); });
    return () => { cancelled = true; };
  }, [ticket.title, ticket.client]);
  const [events, setEvents] = useState<TicketEvent[] | null>(null);
  const [comment, setComment] = useState("");
  const [description, setDescription] = useState(ticket.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = data.me;
  const handler = canHandleTicket(me, ticket.teamId);
  const isRequester = ticket.requesterId === me.id;
  const team = ticket.teamId ? data.teams.find((entry) => entry.id === ticket.teamId) : null;
  const sla = slaStatus(ticket);
  const solve = resolutionStatus(ticket);

  const loadEvents = useCallback(async () => {
    const response = await fetch(`/api/tickets?ticketId=${ticket.id}`, { cache: "no-store" });
    const json = await response.json() as { events?: TicketEvent[]; error?: string };
    if (response.ok && json.events) setEvents(json.events); else setError(json.error || "Não foi possível carregar a atividade.");
  }, [ticket.id]);

  useEffect(() => { const timer = window.setTimeout(() => { void loadEvents(); }, 0); return () => window.clearTimeout(timer); }, [loadEvents, ticket.updatedAt]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest("textarea, input"))) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }

  const send = () => run(async () => {
    if (!comment.trim()) return;
    await post({ action: "addComment", ticketId: ticket.id, body: comment });
    setComment("");
    await Promise.all([loadEvents(), onReload()]);
  });

  const createTask = () => run(async () => {
    const result = await post({ action: "createTask", ticketId: ticket.id });
    await onReload();
    if (result.task && window.confirm(`Demanda ${taskCode(result.task.id)} criada. Abrir agora?`)) onOpenTask(result.task.id);
  });

  // Rascunho do artigo: o relato do chamado e os comentários de quem atendeu (revisados antes de salvar).
  function saveSolution() {
    const comments = (events ?? []).filter((event) => event.kind === "comment" && event.actorId !== ticket.requesterId).map((event) => `- ${event.body.replace(/\s+/g, " ").trim()}`);
    const body = [`Sintoma:\n${ticket.description.trim() || ticket.title}`, comments.length ? `Como foi resolvido:\n${comments.join("\n")}` : "Como foi resolvido:\n1. "].join("\n\n");
    onSaveSolution({ title: ticket.title, body, ticketId: ticket.id, teamId: ticket.teamId, clientName: ticket.client });
  }

  const removeComment = (eventId: number) => run(async () => {
    if (!window.confirm("Excluir este comentário?")) return;
    await post({ action: "deleteComment", eventId });
    await Promise.all([loadEvents(), onReload()]);
  });

  const removeTicket = () => run(async () => {
    if (!window.confirm(`Excluir ${ticketCode(ticket.id)} “${ticket.title}”? Os comentários também serão apagados. Esta ação não pode ser desfeita.`)) return;
    await post({ action: "deleteTicket", ticketId: ticket.id });
    onClose();
    await onReload();
  });

  return <div className="task-drawer-layer">
    <button className="backdrop" onClick={onClose} aria-label="Fechar chamado" />
    <aside className="task-drawer" role="dialog" aria-label={`${ticketCode(ticket.id)} ${ticket.title}`}>
      <header className="task-drawer-head">
        <span className="task-code">{ticketCode(ticket.id)}</span>
        <span className="task-drawer-created">Aberto por {ticket.requesterName} · {relativeTime(ticket.createdAt)}</span>
        {me.isAdmin && <button className="task-drawer-icon danger" onClick={removeTicket} aria-label="Excluir chamado" title="Excluir chamado"><Trash2 size={15} /></button>}
        <button className="task-drawer-icon" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)"><X size={16} /></button>
      </header>
      <div className="task-drawer-body">
        <div className="task-drawer-main">
          <div className="ticket-drawer-badges"><UrgencyBadge urgency={ticket.urgency} /><StatusPill status={ticket.status} />{team && <TeamChip team={team} />}<span className="ticket-type">{ticketTypeLabels[ticket.type]}</span>{ticket.client && <span className="ticket-type">Cliente: {ticket.client}</span>}</div>
          <h2 className="ticket-drawer-title">{ticket.title}</h2>
          {ticket.externalUrl && <p className="jira-origin"><span className="jira-badge">{ticket.externalKey}</span> Veio do Jira{ticket.externalStatus ? <> · lá está <b>{ticket.externalStatus}</b></> : null}. Responda ao cliente pelo Jira; os comentários daqui ficam só para a equipe. <a href={ticket.externalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Abrir no Jira</a></p>}
          <textarea className="task-description-input" readOnly={(!handler && !isRequester) || ticket.source === "jira"} title={ticket.source === "jira" ? "A descrição vem do Jira; edite lá." : undefined} value={description} rows={5} placeholder="Sem detalhes."
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => { if (description !== ticket.description && handler) void onUpdate({ description }); }} />

          <div className="ticket-actions">
            {handler && isActiveTicket(ticket.status) && ticket.assigneeId !== me.id && <button className="primary-button" disabled={busy} onClick={() => run(() => onUpdate({ assigneeId: me.id, ...(ticket.status === "open" ? { status: "in_progress" } : {}) }))}><Hand size={15} /> Assumir</button>}
            {handler && isActiveTicket(ticket.status) && <button className="secondary-button" disabled={busy} onClick={() => run(() => onUpdate({ status: "resolved" }))}><CircleCheck size={15} /> Resolver</button>}
            {handler && !ticket.taskId && <button className="secondary-button" disabled={busy} onClick={createTask}><ListTodo size={15} /> Criar demanda</button>}
            {ticket.taskId && <button className="secondary-button" onClick={() => onOpenTask(ticket.taskId!)}><ListTodo size={15} /> Ver {taskCode(ticket.taskId)}</button>}
            {!handler && isRequester && isActiveTicket(ticket.status) && <button className="secondary-button modal-delete" disabled={busy} onClick={() => run(() => onUpdate({ status: "canceled" }))}><X size={15} /> Cancelar chamado</button>}
            {isRequester && ticket.status === "resolved" && <button className="secondary-button" disabled={busy} onClick={() => run(() => onUpdate({ status: "open" }))}><RotateCcw size={15} /> Reabrir</button>}
            {me.canEdit && ticket.status === "resolved" && <button className="secondary-button" onClick={saveSolution} title="Cria um artigo na base de conhecimento com o que resolveu este chamado"><BookOpen size={15} /> Salvar solução na base</button>}
          </div>

          {related.length > 0 && isActiveTicket(ticket.status) && <div className="kb-related">
            <span><BookOpen size={13} /> Pode ajudar (base de conhecimento)</span>
            {related.map((article) => <button key={article.id} onClick={() => onOpenArticle(article.id)}>{article.title}</button>)}
          </div>}

          {error && <p className="modal-error task-drawer-error">{error}</p>}

          <h3 className="task-activity-title">Atividade</h3>
          {!events ? <div className="loading-list"><span /></div> : <ol className="task-activity">
            {events.map((event) => event.kind === "comment" ? (
              <li key={event.id} className="task-comment">
                <Avatar member={event.actorId ? data.members.find((person) => person.id === event.actorId) : null} size={24} />
                <div><p><strong>{event.actorName}</strong><span>{relativeTime(event.createdAt)}</span>{event.canDelete && <button onClick={() => removeComment(event.id)} aria-label="Excluir comentário" title="Excluir comentário"><Trash2 size={12} /></button>}</p><div className="task-comment-body">{splitMentions(event.body, data.members).map((part, index) => part.mention ? <mark key={index} className="mention">{part.text}</mark> : <span key={index}>{part.text}</span>)}</div></div>
              </li>
            ) : (
              <li key={event.id} className="task-change"><span className="task-change-dot" /><p><strong>{event.actorName}</strong> {describeTicketEvent(event.kind, event.body)} <span>· {relativeTime(event.createdAt)}</span></p></li>
            ))}
          </ol>}
          {me.canEdit && <form className="task-comment-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <MentionTextarea value={comment} onChange={setComment} members={data.members} onSubmit={() => void send()} />
            <button className="primary-button" disabled={busy || !comment.trim()}><Send size={14} /> Comentar</button>
          </form>}
        </div>
        <div className="task-drawer-side ticket-side">
          <label className="task-prop"><span>Status</span><span className="task-prop-control"><select disabled={!handler} value={ticket.status} onChange={(event) => void onUpdate({ status: event.target.value })}>{ticketStatuses.map((value) => <option key={value} value={value}>{ticketStatusLabels[value]}</option>)}</select></span></label>
          <label className="task-prop"><span>Responsável</span><span className="task-prop-control"><Avatar member={ticket.assigneeId ? data.members.find((person) => person.id === ticket.assigneeId) : null} size={18} /><select disabled={!handler} value={ticket.assigneeId ?? ""} onChange={(event) => void onUpdate({ assigneeId: event.target.value ? Number(event.target.value) : null })}><option value="">Ninguém ainda</option>{data.members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></span></label>
          <label className="task-prop"><span>Urgência</span><span className="task-prop-control"><select disabled={!handler} value={ticket.urgency} onChange={(event) => void onUpdate({ urgency: event.target.value })}>{ticketUrgencies.map((value) => <option key={value} value={value}>{ticketUrgencyLabels[value]}</option>)}</select></span></label>
          <label className="task-prop"><span>Tipo</span><span className="task-prop-control"><select disabled={!handler} value={ticket.type} onChange={(event) => void onUpdate({ type: event.target.value })}>{ticketTypes.map((value) => <option key={value} value={value}>{ticketTypeLabels[value]}</option>)}</select></span></label>
          {data.teams.length > 0 && <label className="task-prop"><span>Time responsável</span><span className="task-prop-control"><select disabled={!handler} value={ticket.teamId ?? ""} onChange={(event) => void onUpdate({ teamId: event.target.value ? Number(event.target.value) : null })}><option value="">Sem time</option>{data.teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></span></label>}
          <div className="ticket-sla">
            <span>Primeira resposta</span>
            <strong className={sla.state}>{sla.state === "met" ? "Respondido no prazo" : sla.state === "late" ? "Respondido fora do prazo" : !isActiveTicket(ticket.status) ? "Sem resposta registrada" : sla.state === "breached" ? `Atrasada em ${formatMinutes(-sla.minutesLeft)}` : `Faltam ${formatMinutes(sla.minutesLeft)}`}</strong>
            <span>Solução (até {formatMinutes(resolutionHours[ticket.urgency] * 60)})</span>
            <strong className={solve?.state ?? "met"}>{!solve ? "Cancelado" : solve.state === "met" ? "Resolvido no prazo" : solve.state === "late" ? "Resolvido fora do prazo" : solve.state === "breached" ? `Atrasada em ${formatMinutes(-solve.minutesLeft)}` : `Faltam ${formatMinutes(solve.minutesLeft)}`}</strong>
            {!handler && <small>Só o time {team?.name ?? "responsável"} altera estes campos.</small>}
          </div>
        </div>
      </div>
    </aside>
  </div>;
}

/** Resumo para a visão geral: o que pede atenção na fila do meu time e nos meus chamados. */
export function MyTicketsPanel({ onOpen }: { onOpen: (ticketId?: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch("/api/tickets", { cache: "no-store" });
        if (!response.ok) return;
        const json = await response.json() as Data;
        if (!cancelled) setData(json);
      } catch { /* o painel é opcional */ }
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;
  const me = data.me;
  const active = data.tickets.filter((ticket) => isActiveTicket(ticket.status));
  const queue = active.filter((ticket) => ticket.teamId !== null && me.teamIds.includes(ticket.teamId));
  const late = queue.filter((ticket) => isTicketLate(ticket)).length;
  const requested = active.filter((ticket) => ticket.requesterId === me.id).length;
  // Primeiro o que é meu; depois o que está sem dono na fila do meu time.
  const focus = [...active.filter((ticket) => ticket.assigneeId === me.id), ...queue.filter((ticket) => ticket.assigneeId === null)].sort(compareTickets).slice(0, 4);

  return <article className="hub-tasks">
    <div className="hub-panel-title"><div><span><LifeBuoy /></span><div><h3>Chamados</h3><p>{me.teamIds.length ? `${queue.length} na fila do seu time${late ? ` · ${late} fora do prazo` : ""}` : "Você ainda não está em nenhum time"}{requested ? ` · ${requested} aberto${requested === 1 ? "" : "s"} por você` : ""}</p></div></div><button onClick={() => onOpen()}>Abrir chamados</button></div>
    {focus.length ? focus.map((ticket) => <button key={ticket.id} className="hub-task-row" onClick={() => onOpen(ticket.id)}>
      <UrgencyBadge urgency={ticket.urgency} /><span className="task-code">{ticketCode(ticket.id)}</span><span className="task-title">{ticket.title}</span><SlaBadge ticket={ticket} />
    </button>) : <div className="hub-empty-row"><LifeBuoy /><span><strong>Nada esperando por você</strong><small>Chamados atribuídos a você ou sem dono na fila do seu time aparecem aqui.</small></span></div>}
  </article>;
}

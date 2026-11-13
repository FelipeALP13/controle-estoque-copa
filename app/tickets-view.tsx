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
import AttachmentsPanel from "./attachments-panel";
import TicketRatingCard from "./ticket-rating-card";
import { canRate } from "./ticket-rating";
import type { ArticleDraft } from "./knowledge-view";
import { downloadXlsx } from "./xlsx-writer";
import Columns3 from "lucide-react/icons/columns-3";
import List from "lucide-react/icons/list";
import MessageSquareText from "lucide-react/icons/message-square-text";
import Pencil from "lucide-react/icons/pencil";
import { fillReply, onTicketBoard, REPLY_FIELDS, repliesFor, TICKET_BOARD_STATUSES, type TicketBoardStatus } from "./team-tools";
import { canHandleTicket, compareTickets, describeTicketEvent, formatMinutes, isActiveTicket, isTicketLate, parseStoredDate, resolutionHours, resolutionStatus, slaStatus, ticketCode, ticketStatuses, ticketStatusLabels, ticketTypeLabels, ticketTypes, ticketUrgencies, ticketUrgencyLabels, type TicketEventKind, type TicketStatus, type TicketType, type TicketUrgency } from "./tickets";

type Ticket = {
  id: number; title: string; description: string; type: TicketType; urgency: TicketUrgency; status: TicketStatus; client: string;
  teamId: number | null; requesterId: number | null; requesterName: string; assigneeId: number | null; taskId: number | null;
  firstResponseAt: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string; commentCount: number;
  source: "portal" | "jira"; externalKey: string | null; externalUrl: string | null; externalStatus: string | null;
  rating: number | null; ratingComment: string; ratedAt: string | null;
};
type Person = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
type Team = { id: number; name: string; color: string };
type Viewer = { id: number; isAdmin: boolean; canEdit: boolean; teamIds: number[] };
type TicketEvent = { id: number; kind: TicketEventKind; body: string; actorId: number | null; actorName: string; createdAt: string; canDelete: boolean; externalId?: string | null };
type Reply = { id: number; title: string; body: string; teamId: number | null; createdByName: string; canEdit: boolean };
type Data = { tickets: Ticket[]; members: Person[]; teams: Team[]; me: Viewer; replies?: Reply[] };
type Layout = "list" | "board";
const LAYOUT_KEY = "portal.tickets.layout";
function savedLayout(): Layout {
  try { return typeof window !== "undefined" && window.localStorage.getItem(LAYOUT_KEY) === "board" ? "board" : "list"; } catch { return "list"; }
}
type Scope = "queue" | "requested" | "assigned" | "all";

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; ticket?: Ticket; task?: { id: number }; jiraWarning?: string | null };
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

export default function TicketsView({ openRequest = null, onOpenRequestHandled, onOpenTask, onOpenArticle, onSaveSolution, createRequest = 0 }: { openRequest?: number | null; onOpenRequestHandled?: () => void; onOpenTask: (taskId: number) => void; onOpenArticle: (articleId: number) => void; onSaveSolution: (draft: ArticleDraft) => void; createRequest?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<Scope | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "closed" | "all">("active");
  const [teamFilter, setTeamFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [jiraOpen, setJiraOpen] = useState(false);
  const [layout, setLayoutState] = useState<Layout>(savedLayout);
  const [managingReplies, setManagingReplies] = useState(false);
  function setLayout(next: Layout) {
    setLayoutState(next);
    try { window.localStorage.setItem(LAYOUT_KEY, next); } catch { /* só preferência */ }
  }
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

  // Atalho "Abrir chamado" da visão geral.
  const handledCreate = useRef(0);
  useEffect(() => {
    if (!createRequest || !data?.me.canEdit || handledCreate.current === createRequest) return;
    handledCreate.current = createRequest;
    const timer = window.setTimeout(() => setCreating(true), 0);
    return () => window.clearTimeout(timer);
  }, [createRequest, data]);

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

  const matchesSearch = useCallback((ticket: Ticket) => {
    const query = fold(search.trim());
    return !query || fold(`${ticketCode(ticket.id)} ${ticket.externalKey ?? ""} ${ticket.title} ${ticket.client} ${ticket.requesterName}`).includes(query);
  }, [search]);
  const visible = useMemo(() => inScope.filter((ticket) => {
    if (statusFilter === "active" && !isActiveTicket(ticket.status)) return false;
    if (statusFilter === "closed" && isActiveTicket(ticket.status)) return false;
    return matchesSearch(ticket);
  }).sort(compareTickets), [inScope, statusFilter, matchesSearch]);
  // Quadro: os em aberto e os resolvidos nos últimos 7 dias, por coluna.
  const [boardNow] = useState(() => Date.now());
  const board = useMemo(() => {
    const columns = Object.fromEntries(TICKET_BOARD_STATUSES.map((status) => [status, [] as Ticket[]])) as Record<TicketBoardStatus, Ticket[]>;
    for (const ticket of inScope) if (onTicketBoard(ticket, data ? boardNow : 0) && matchesSearch(ticket) && ticket.status !== "canceled") columns[ticket.status as TicketBoardStatus].push(ticket);
    for (const status of TICKET_BOARD_STATUSES) columns[status].sort(status === "resolved" ? (a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "") : compareTickets);
    return columns;
  }, [inScope, matchesSearch, data, boardNow]);

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
      if (result.jiraWarning) setError(result.jiraWarning);
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
      {layout === "list" && <select aria-label="Situação" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="active">Em aberto</option><option value="closed">Encerrados</option><option value="all">Todos</option></select>}
      <div className="tasks-view-toggle" role="group" aria-label="Como mostrar">
        <button className={layout === "list" ? "active" : ""} aria-pressed={layout === "list"} onClick={() => setLayout("list")} title="Lista"><List size={15} /> Lista</button>
        <button className={layout === "board" ? "active" : ""} aria-pressed={layout === "board"} onClick={() => setLayout("board")} title="Quadro"><Columns3 size={15} /> Quadro</button>
      </div>
      {data?.me.canEdit && <button className="secondary-button" onClick={() => setManagingReplies(true)} title="Textos prontos para responder os chamados"><MessageSquareText size={15} /> Respostas prontas</button>}
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

      {layout === "board" ? <TicketBoard columns={board} me={data.me} teamsById={teamsById} peopleById={peopleById} onOpen={setOpenId} onMove={(ticketId, status) => void update(ticketId, { status })} /> : visible.length === 0 ? <div className="empty-state"><span><LifeBuoy /></span><h3>{data.tickets.length ? "Nenhum chamado aqui" : "Nenhum chamado ainda"}</h3><p>{data.tickets.length ? "Troque a fila, o filtro de situação ou a busca." : "Quando alguém precisar de outro time, é só abrir um chamado. Ele cai direto na fila do time."}</p>{data.me.canEdit && !data.tickets.length && <div><button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> Abrir chamado</button></div>}</div> : (
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
    {managingReplies && data && <RepliesModal replies={data.replies ?? []} teams={data.teams} me={data.me} onClose={() => setManagingReplies(false)} onChanged={load} />}
    {openTicket && data && <TicketDrawer key={openTicket.id} ticket={openTicket} data={data} onManageReplies={() => setManagingReplies(true)} onClose={() => setOpenId(null)} onUpdate={(changes) => update(openTicket.id, changes)} onReload={load} onOpenTask={onOpenTask} onOpenArticle={onOpenArticle} onSaveSolution={onSaveSolution} />}
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
    <div className="modal-head"><div><h2>Abrir chamado</h2><p>O chamado cai na fila do time escolhido, e todos do time são avisados.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
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

function TicketDrawer({ ticket, data, onManageReplies, onClose, onUpdate, onReload, onOpenTask, onOpenArticle, onSaveSolution }: { ticket: Ticket; data: Data; onManageReplies: () => void; onClose: () => void; onUpdate: (changes: Record<string, unknown>) => Promise<void>; onReload: () => Promise<void>; onOpenTask: (taskId: number) => void; onOpenArticle: (articleId: number) => void; onSaveSolution: (draft: ArticleDraft) => void }) {
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
  const fromJira = ticket.source === "jira";
  const [toClient, setToClient] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const usableReplies = repliesFor(data.replies ?? [], ticket.teamId);
  function insertReply(reply: Reply) {
    const me = data.members.find((person) => person.id === data.me.id);
    const text = fillReply(reply.body, { cliente: ticket.client, solicitante: ticket.requesterName, codigo: ticketCode(ticket.id), titulo: ticket.title, eu: me?.name ?? "" });
    setComment((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text));
    setRepliesOpen(false);
  }

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
    await post({ action: "addComment", ticketId: ticket.id, body: comment, sendToJira: fromJira && toClient });
    setComment("");
    setToClient(false);
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

          {ticket.status === "resolved" && <TicketRatingCard ticket={ticket} canRateNow={canRate(ticket, me.id)} onRate={async (rating, text) => { await post({ action: "rateTicket", ticketId: ticket.id, rating, comment: text }); await onReload(); }} />}

          <AttachmentsPanel ownerType="ticket" ownerId={ticket.id} />

          {error && <p className="modal-error task-drawer-error">{error}</p>}

          <h3 className="task-activity-title">Atividade</h3>
          {!events ? <div className="loading-list"><span /></div> : <ol className="task-activity">
            {events.map((event) => event.kind === "comment" ? (
              <li key={event.id} className="task-comment">
                <Avatar member={event.actorId ? data.members.find((person) => person.id === event.actorId) : null} size={24} />
                <div><p><strong>{event.actorName}</strong><span>{relativeTime(event.createdAt)}</span>{fromJira && event.actorId !== null && (event.externalId ? <em className="comment-tag sent">Enviado ao cliente</em> : <em className="comment-tag internal">Nota interna</em>)}{event.canDelete && <button onClick={() => removeComment(event.id)} aria-label="Excluir comentário" title="Excluir comentário"><Trash2 size={12} /></button>}</p><div className="task-comment-body">{splitMentions(event.body, data.members).map((part, index) => part.mention ? <mark key={index} className="mention">{part.text}</mark> : <span key={index}>{part.text}</span>)}</div></div>
              </li>
            ) : (
              <li key={event.id} className="task-change"><span className="task-change-dot" /><p><strong>{event.actorName}</strong> {describeTicketEvent(event.kind, event.body)} <span>· {relativeTime(event.createdAt)}</span></p></li>
            ))}
          </ol>}
          {me.canEdit && <form className="task-comment-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <div className="reply-picker">
              <button type="button" className="link-button" onClick={() => setRepliesOpen((value) => !value)} aria-expanded={repliesOpen}><MessageSquareText size={13} /> Respostas prontas{usableReplies.length ? ` (${usableReplies.length})` : ""}</button>
              {repliesOpen && <div className="reply-menu" role="menu">
                {usableReplies.length ? usableReplies.map((reply) => <button type="button" role="menuitem" key={reply.id} onClick={() => insertReply(reply)}><strong>{reply.title}</strong><small>{reply.teamId ? data.teams.find((team) => team.id === reply.teamId)?.name ?? "Time" : "Todos os times"}</small><span>{reply.body.slice(0, 110)}{reply.body.length > 110 ? "…" : ""}</span></button>) : <p className="muted">Nenhuma resposta pronta ainda.</p>}
                <button type="button" className="reply-menu-manage" onClick={() => { setRepliesOpen(false); onManageReplies(); }}><Pencil size={12} /> Criar ou editar respostas</button>
              </div>}
            </div>
            <MentionTextarea value={comment} onChange={setComment} members={data.members} onSubmit={() => void send()} />
            {fromJira && handler && <label className={`jira-send ${toClient ? "on" : ""}`}><input type="checkbox" checked={toClient} onChange={(event) => setToClient(event.target.checked)} /> Enviar ao cliente no Jira <small>{toClient ? "o cliente vê este comentário no Jira" : "sem marcar, fica só como nota interna da equipe"}</small></label>}
            <button className="primary-button" disabled={busy || !comment.trim()}><Send size={14} /> {fromJira && toClient ? "Enviar ao cliente" : "Comentar"}</button>
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

/** Quadro de chamados: arraste o cartão para mudar o status (só quem atende o time do chamado). */
function TicketBoard({ columns, me, teamsById, peopleById, onOpen, onMove }: { columns: Record<TicketBoardStatus, Ticket[]>; me: Viewer; teamsById: Map<number, Team>; peopleById: Map<number, Person>; onOpen: (id: number) => void; onMove: (ticketId: number, status: TicketStatus) => void }) {
  const [drag, setDrag] = useState<Ticket | null>(null);
  const [over, setOver] = useState<TicketBoardStatus | null>(null);
  const finish = () => { setDrag(null); setOver(null); };
  return <div className="task-board ticket-board">
    {TICKET_BOARD_STATUSES.map((status) => <section key={status} className={`board-column ${over === status ? "drop-target" : ""}`}
      onDragOver={(event) => { if (!drag || drag.status === status) return; event.preventDefault(); if (over !== status) setOver(status); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null); }}
      onDrop={(event) => { event.preventDefault(); if (drag && drag.status !== status) onMove(drag.id, status); finish(); }}>
      <header><StatusPill status={status} /><span>{columns[status].length}</span>{status === "resolved" && <small className="board-hint">últimos 7 dias</small>}</header>
      <div className="board-cards">
        {columns[status].map((ticket) => {
          const team = ticket.teamId ? teamsById.get(ticket.teamId) : null;
          const movable = canHandleTicket(me, ticket.teamId);
          return <button key={ticket.id} className={`board-card ticket-card ${drag?.id === ticket.id ? "dragging" : ""} ${isTicketLate(ticket) ? "late" : ""}`} draggable={movable} onClick={() => onOpen(ticket.id)}
            title={movable ? "Clique para abrir ou arraste para mudar o status" : "Só o time do chamado muda o status"}
            onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(ticket.id)); setDrag(ticket); }} onDragEnd={finish}>
            <span className="board-card-top"><span className="task-code">{ticketCode(ticket.id)}</span>{ticket.externalKey && <span className="jira-badge">{ticket.externalKey}</span>}<UrgencyBadge urgency={ticket.urgency} /></span>
            <span className="board-card-title"><span>{ticket.title}</span></span>
            {(ticket.client || ticket.requesterName) && <span className="board-card-client">{ticket.client ? `${ticket.client} · ` : ""}por {ticket.requesterName}</span>}
            <span className="board-card-meta">{team && <TeamChip team={team} />}<SlaBadge ticket={ticket} />{ticket.commentCount > 0 && <span className="task-comments"><MessageSquare size={12} />{ticket.commentCount}</span>}<Avatar member={ticket.assigneeId ? peopleById.get(ticket.assigneeId) : null} size={20} /></span>
          </button>;
        })}
        {!columns[status].length && <p className="board-empty">{status === "resolved" ? "Nada resolvido nos últimos 7 dias" : "Nenhum chamado"}</p>}
      </div>
    </section>)}
  </div>;
}

/** Respostas prontas: textos com campos ({cliente}, {solicitante}...) inseridos no comentário com um clique. */
function RepliesModal({ replies, teams, me, onClose, onChanged }: { replies: Reply[]; teams: Team[]; me: Viewer; onClose: () => void; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<Reply | "new" | null>(replies.length ? null : "new");
  const [form, setForm] = useState({ title: "", body: "", teamId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const myTeams = me.isAdmin ? teams : teams.filter((team) => me.teamIds.includes(team.id));

  function start(reply: Reply | "new") {
    setEditing(reply);
    setError("");
    setForm(reply === "new" ? { title: "", body: "", teamId: myTeams.length === 1 ? String(myTeams[0].id) : "" } : { title: reply.title, body: reply.body, teamId: reply.teamId ? String(reply.teamId) : "" });
  }

  async function run(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await post(payload);
      await onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal replies-modal">
    <div className="modal-head"><div><h2>Respostas prontas</h2><p>Textos usados com frequência. No chamado, clique em “Respostas prontas” acima do comentário.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="templates-body">
      {editing ? <form className="form-grid" onSubmit={async (event) => { event.preventDefault(); if (await run({ action: "saveReply", replyId: editing === "new" ? undefined : editing.id, title: form.title, body: form.body, teamId: form.teamId ? Number(form.teamId) : null })) setEditing(null); }}>
        <label><span>Nome</span><input autoFocus required maxLength={60} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Pedir print do erro" /></label>
        <label><span>Quem usa</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Todos os times</option>{myTeams.map((team) => <option key={team.id} value={team.id}>Só {team.name}</option>)}</select></label>
        <label className="full"><span>Texto</span><textarea required rows={6} maxLength={2000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder={"Olá {solicitante}, tudo bem?\nPode mandar um print da mensagem de erro que aparece para a {cliente}?"} /></label>
        <p className="full form-hint">Campos que viram o dado do chamado: {REPLY_FIELDS.map((field) => <button type="button" key={field.key} className="reply-field" onClick={() => setForm({ ...form, body: `${form.body}{${field.key}}` })} title={`Inserir ${field.label}`}>{`{${field.key}}`}</button>)}</p>
        {error && <p className="modal-error full">{error}</p>}
        <div className="modal-actions full">
          {editing !== "new" && <button type="button" className="secondary-button modal-delete" disabled={busy} onClick={async () => { if (window.confirm(`Excluir a resposta “${editing.title}”?`) && await run({ action: "deleteReply", replyId: editing.id })) setEditing(null); }}><Trash2 size={15} /> Excluir</button>}
          <button type="button" className="secondary-button" onClick={() => setEditing(replies.length ? null : "new")}>{replies.length ? "Voltar" : "Limpar"}</button>
          <button className="primary-button" disabled={busy || !form.title.trim() || !form.body.trim()}>{busy ? "Salvando..." : "Salvar resposta"}</button>
        </div>
      </form> : <>
        {replies.length ? <ul className="templates-list">{replies.map((reply) => <li key={reply.id}>
          <div><strong>{reply.title}</strong><small>{reply.teamId ? `Só ${teams.find((team) => team.id === reply.teamId)?.name ?? "um time"}` : "Todos os times"} · por {reply.createdByName}</small></div>
          {reply.canEdit && <button className="person-edit" onClick={() => start(reply)} aria-label={`Editar ${reply.title}`} title="Editar"><Pencil size={14} /></button>}
        </li>)}</ul> : <p className="muted">Nenhuma resposta pronta ainda.</p>}
        {error && <p className="modal-error">{error}</p>}
        <div className="templates-actions"><button className="primary-button" onClick={() => start("new")}><Plus size={15} /> Nova resposta</button></div>
      </>}
    </div>
  </div></div>;
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

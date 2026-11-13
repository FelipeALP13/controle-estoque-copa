"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Building2 from "lucide-react/icons/building-2";
import Copy from "lucide-react/icons/copy";
import Eye from "lucide-react/icons/eye";
import EyeOff from "lucide-react/icons/eye-off";
import ExternalLink from "lucide-react/icons/external-link";
import FileDown from "lucide-react/icons/file-down";
import KeyRound from "lucide-react/icons/key-round";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import RefreshCw from "lucide-react/icons/refresh-cw";
import Search from "lucide-react/icons/search";
import ServerCrash from "lucide-react/icons/server-crash";
import Trash2 from "lucide-react/icons/trash-2";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import X from "lucide-react/icons/x";
import { ENVIRONMENTS, environmentLabel, hoursUsage, portWarning, uptimePercent, type Environment } from "./office-tools";
import { formatHours, monthLabel, shiftMonth } from "./time-entries";
import { taskCode, taskStatusLabels, type TaskStatus } from "./tasks";
import { formatMinutes, ticketCode, ticketStatusLabels, ticketUrgencyLabels, type TicketStatus, type TicketUrgency } from "./tickets";
import { downloadXlsx } from "./xlsx-writer";
import { relativeTime } from "./task-shared";

type Viewer = { id: number; isAdmin: boolean; canEdit: boolean; teamIds: number[] };
type ClientRow = { id: number; name: string; active: boolean; monthlyHours: number | null; contactName: string; openTasks: number; openTickets: number; hoursThisMonth: number; systems: number; systemsDown: number };
type DownSystem = { id: number; name: string; clientId: number; clientName: string; since: string | null; error: string | null };
type ListData = { month: string; clients: ClientRow[]; monitored: number; down: DownSystem[]; me: Viewer };
type System = { id: number; clientId: number; teamId: number | null; name: string; environment: Environment; url: string; notes: string; monitor: boolean; status: "unknown" | "up" | "down"; lastCheckedAt: string | null; lastChangeAt: string | null; lastMs: number | null; lastError: string | null; username: string | null; hasPassword: boolean; canSeeLogin: boolean; events: { kind: "down" | "up"; at: string; detail: string }[] };
type Client = { id: number; name: string; active: boolean; contactName: string; contactEmail: string; contactPhone: string; monthlyHours: number | null; notes: string };
type Detail = {
  client: Client; systems: System[]; teams: { id: number; name: string; color: string }[]; me: Viewer;
  tickets: { id: number; title: string; status: TicketStatus; urgency: TicketUrgency; createdAt: string; externalKey: string | null; assigneeName: string }[];
  ticketCounts: { open: number; total: number };
  tasks: { id: number; title: string; status: TaskStatus; dueDate: string | null }[];
  doneTasks: { id: number; title: string; status: TaskStatus; completedOn: string | null }[];
  hoursByMonth: { month: string; hours: number }[];
};

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; password?: string; result?: { ok: boolean; status: string; ms: number; error: string | null } };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
const todayMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);

export default function ClientsView({ onOpenTask, onOpenTicket }: { onOpenTask: (taskId: number) => void; onOpenTicket: (ticketId: number) => void }) {
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/clients", { cache: "no-store" });
      const json = await response.json() as ListData & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar os clientes.");
      setData(json);
      setSelected((current) => current ?? json.clients.find((client) => client.active)?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os clientes.");
    }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);

  const list = useMemo(() => (data?.clients ?? []).filter((client) => !search.trim() || fold(`${client.name} ${client.contactName}`).includes(fold(search.trim()))), [data, search]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div>;

  return <div className="clients-page">
    {data.monitored > 0 && <div className={`monitor-banner ${data.down.length ? "down" : "up"}`}>
      {data.down.length ? <ServerCrash size={18} /> : <span className="monitor-dot up" />}
      <div><strong>{data.down.length ? `${data.down.length} ${data.down.length === 1 ? "sistema fora do ar" : "sistemas fora do ar"}` : "Todos os sistemas monitorados estão no ar"}</strong>
        <small>{data.down.length ? data.down.map((system) => `${system.clientName} · ${system.name}${system.since ? ` (${relativeTime(system.since)})` : ""}`).join("  ·  ") : `${data.monitored} ${data.monitored === 1 ? "sistema verificado" : "sistemas verificados"} a cada 5 minutos enquanto o Portal está aberto`}</small></div>
    </div>}
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    <div className="clients-layout">
      <aside className="clients-list">
        <label className="tasks-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente" /></label>
        {list.length ? <ul>{list.map((client) => {
          const usage = hoursUsage(client.hoursThisMonth, client.monthlyHours);
          return <li key={client.id}><button className={`${selected === client.id ? "active" : ""} ${client.active ? "" : "inactive"}`} onClick={() => setSelected(client.id)}>
            <span className="clients-list-name"><strong>{client.name}</strong>{client.systemsDown > 0 && <em className="monitor-chip down" title="Sistema fora do ar">fora do ar</em>}</span>
            <small>{client.openTickets} chamado{client.openTickets === 1 ? "" : "s"} · {client.openTasks} demanda{client.openTasks === 1 ? "" : "s"}{client.monthlyHours ? <> · <b className={`usage-${usage.state}`}>{usage.percent}% do pacote</b></> : null}</small>
          </button></li>;
        })}</ul> : <p className="muted">Nenhum cliente encontrado. A lista vem de Demandas → Clientes.</p>}
      </aside>
      {selected ? <ClientDetail key={selected} clientId={selected} onOpenTask={onOpenTask} onOpenTicket={onOpenTicket} onChanged={load} /> : <div className="empty-state"><span><Building2 /></span><h3>Escolha um cliente</h3><p>A ficha mostra os acessos aos sistemas, os chamados, as demandas e as horas do mês.</p></div>}
    </div>
  </div>;
}

function ClientDetail({ clientId, onOpenTask, onOpenTicket, onChanged }: { clientId: number; onOpenTask: (taskId: number) => void; onOpenTicket: (ticketId: number) => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingSystem, setEditingSystem] = useState<System | "new" | null>(null);
  const [reportMonth, setReportMonth] = useState(() => shiftMonth(todayMonth(), -1));
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/clients?clientId=${clientId}`, { cache: "no-store" });
      const json = await response.json() as Detail & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar a ficha.");
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a ficha.");
    }
  }, [clientId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function downloadReport() {
    if (!detail) return;
    setReporting(true);
    setError("");
    try {
      const response = await fetch(`/api/clients?report=${clientId}&month=${reportMonth}`, { cache: "no-store" });
      const report = await response.json() as ClientReport & { error?: string };
      if (!response.ok) throw new Error(report.error || "Não foi possível gerar o relatório.");
      downloadClientReport(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o relatório.");
    } finally {
      setReporting(false);
    }
  }

  if (!detail) return <section className="client-detail">{error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>}</section>;
  const { client, me } = detail;
  const month = todayMonth();
  const thisMonth = detail.hoursByMonth.find((row) => row.month === month)?.hours ?? 0;
  const usage = hoursUsage(thisMonth, client.monthlyHours);
  const maxHours = Math.max(client.monthlyHours ?? 0, ...detail.hoursByMonth.map((row) => row.hours), 1);
  const months = Array.from({ length: 6 }, (_, index) => shiftMonth(month, index - 5));

  return <section className="client-detail">
    <header className="client-head">
      <span className="client-avatar"><Building2 size={20} /></span>
      <div><h2>{client.name}{!client.active && <small className="person-inactive">Desativado</small>}</h2>
        <p>{client.contactName ? <>{client.contactName}{client.contactEmail && <> · <a href={`mailto:${client.contactEmail}`}>{client.contactEmail}</a></>}{client.contactPhone && <> · {client.contactPhone}</>}</> : <span className="muted">Contato não informado</span>}</p></div>
      {me.isAdmin && <button className="secondary-button" onClick={() => setEditingProfile(true)}><Pencil size={14} /> Editar ficha</button>}
    </header>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    <div className="client-stats">
      <article><small>Chamados em aberto</small><strong>{detail.ticketCounts.open}</strong><span>{detail.ticketCounts.total} no total</span></article>
      <article><small>Demandas em aberto</small><strong>{detail.tasks.length}</strong><span>{detail.doneTasks.length ? `última entrega ${detail.doneTasks[0].completedOn ? new Date(`${detail.doneTasks[0].completedOn}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : ""}` : "nenhuma entregue ainda"}</span></article>
      <article className={`usage-${usage.state}`}><small>Horas em {monthLabel(month).split(" ")[0]}</small><strong>{formatHours(thisMonth)}</strong>
        <span>{client.monthlyHours ? <>{usage.percent}% de {formatHours(client.monthlyHours)} do pacote{usage.state === "over" ? " · passou do pacote" : usage.state === "warn" ? " · perto do limite" : ""}</> : "sem pacote de horas definido"}</span>
        {client.monthlyHours ? <i className="usage-bar"><b style={{ width: `${Math.min(100, usage.percent ?? 0)}%` }} /></i> : null}</article>
      <article className="client-months"><small>Horas nos últimos 6 meses</small>
        <div className="mini-bars">{months.map((key) => { const hours = detail.hoursByMonth.find((row) => row.month === key)?.hours ?? 0; return <span key={key} title={`${monthLabel(key)}: ${formatHours(hours)}`}><i style={{ height: `${Math.max(2, (hours / maxHours) * 100)}%` }} className={client.monthlyHours && hours > client.monthlyHours ? "over" : ""} /><em>{monthLabel(key).slice(0, 3)}</em></span>; })}</div></article>
    </div>

    <section className="client-section">
      <header><h3><KeyRound size={15} /> Sistemas e acessos</h3>{me.isAdmin && <button className="secondary-button" onClick={() => setEditingSystem("new")}><Plus size={14} /> Novo acesso</button>}</header>
      {detail.systems.length ? <div className="systems-list">{detail.systems.map((system) => <SystemCard key={system.id} system={system} teams={detail.teams} isAdmin={me.isAdmin} onEdit={() => setEditingSystem(system)} onChanged={load} />)}</div>
        : <p className="muted">Nenhum sistema cadastrado.{me.isAdmin ? " Cadastre o endereço e o login de demonstração, homologação ou treinamento." : ""}</p>}
    </section>

    <div className="client-columns">
      <section className="client-section">
        <header><h3>Chamados recentes</h3></header>
        {detail.tickets.length ? <ul className="client-links">{detail.tickets.map((ticket) => <li key={ticket.id}><button onClick={() => onOpenTicket(ticket.id)}><span className="task-code">{ticket.externalKey ?? ticketCode(ticket.id)}</span><span className="client-link-title">{ticket.title}</span><em className={`ticket-status ${ticket.status}`}>{ticketStatusLabels[ticket.status]}</em></button><small>{ticketUrgencyLabels[ticket.urgency]} · {relativeTime(ticket.createdAt)}{ticket.assigneeName ? ` · ${ticket.assigneeName.split(" ")[0]}` : ""}</small></li>)}</ul> : <p className="muted">Nenhum chamado deste cliente.</p>}
      </section>
      <section className="client-section">
        <header><h3>Demandas em aberto</h3></header>
        {detail.tasks.length ? <ul className="client-links">{detail.tasks.map((task) => <li key={task.id}><button onClick={() => onOpenTask(task.id)}><span className="task-code">{taskCode(task.id)}</span><span className="client-link-title">{task.title}</span><em className={`dep-status ${task.status}`}>{taskStatusLabels[task.status]}</em></button>{task.dueDate && <small>prazo {new Date(`${task.dueDate}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</small>}</li>)}</ul> : <p className="muted">Nenhuma demanda em aberto.</p>}
      </section>
    </div>

    <div className="client-columns">
      <section className="client-section">
        <header><h3><FileDown size={15} /> Relatório mensal para o cliente</h3></header>
        <p className="muted">Excel com o resumo do mês (chamados, prazo de resposta, entregas e horas do pacote), a lista de chamados, as demandas entregues e as horas lançadas.</p>
        <div className="client-report">
          <select aria-label="Mês do relatório" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => shiftMonth(month, -index)).map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}</select>
          <button className="primary-button" disabled={reporting} onClick={downloadReport}><FileDown size={15} /> {reporting ? "Gerando..." : "Baixar Excel"}</button>
        </div>
      </section>
      <section className="client-section">
        <header><h3>Observações</h3></header>
        {client.notes ? <p className="client-notes">{client.notes}</p> : <p className="muted">{me.isAdmin ? "Use “Editar ficha” para anotar contrato, horários, particularidades do cliente…" : "Nenhuma observação."}</p>}
      </section>
    </div>

    {editingProfile && <ProfileModal client={client} onClose={() => setEditingProfile(false)} onSaved={async () => { setEditingProfile(false); await Promise.all([load(), onChanged()]); }} />}
    {editingSystem && <SystemModal clientId={client.id} system={editingSystem === "new" ? null : editingSystem} teams={detail.teams} onClose={() => setEditingSystem(null)} onSaved={async () => { setEditingSystem(null); await Promise.all([load(), onChanged()]); }} />}
  </section>;
}

/** Um sistema: endereço, ambiente, login (só para quem pode) e situação do monitor. */
function SystemCard({ system, teams, isAdmin, onEdit, onChanged }: { system: System; teams: Detail["teams"]; isAdmin: boolean; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const team = teams.find((entry) => entry.id === system.teamId);

  // A senha revelada some sozinha depois de 30 segundos.
  useEffect(() => {
    if (password === null) return;
    const timer = window.setTimeout(() => setPassword(null), 30000);
    return () => window.clearTimeout(timer);
  }, [password]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try { await action(); } catch (err) { setMessage(err instanceof Error ? err.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }
  const copy = (text: string, label: string) => navigator.clipboard.writeText(text).then(() => setMessage(`${label} copiado.`), () => setMessage("Não foi possível copiar."));
  const [now] = useState(() => Date.now());
  const uptime = system.monitor && system.events.length ? uptimePercent(system.events, now - 30 * 86400000, now, system.events[0].kind === "up" ? "down" : "up") : null;

  return <article className={`system-card ${system.monitor ? `monitor-${system.status}` : ""}`}>
    <header>
      {system.monitor && <span className={`monitor-dot ${system.status}`} title={system.status === "up" ? "No ar" : system.status === "down" ? "Fora do ar" : "Ainda não verificado"} />}
      <strong>{system.name}</strong>
      <em className={`env-chip ${system.environment}`}>{environmentLabel(system.environment)}</em>
      {team && <small className="system-team">Login: {team.name}</small>}
      <span className="system-actions">
        {system.url && <button className="person-edit" disabled={busy} onClick={() => void run(async () => { const result = (await post({ action: "checkNow", systemId: system.id })).result; setMessage(result ? (result.ok ? `No ar · respondeu em ${result.ms} ms` : `Sem resposta: ${result.error}`) : ""); await onChanged(); })} title="Verificar agora" aria-label="Verificar agora"><RefreshCw size={13} /></button>}
        {isAdmin && <button className="person-edit" onClick={onEdit} title="Editar" aria-label={`Editar ${system.name}`}><Pencil size={13} /></button>}
        {isAdmin && <button className="person-edit" disabled={busy} onClick={() => { if (window.confirm(`Excluir o acesso “${system.name}”? A senha guardada também será apagada.`)) void run(async () => { await post({ action: "deleteSystem", systemId: system.id }); await onChanged(); }); }} title="Excluir" aria-label={`Excluir ${system.name}`}><Trash2 size={13} /></button>}
      </span>
    </header>
    {system.url && <p className="system-url"><a href={system.url} target="_blank" rel="noopener noreferrer">{system.url} <ExternalLink size={12} /></a><button className="link-button" onClick={() => void copy(system.url, "Endereço")}><Copy size={12} /></button></p>}
    {system.canSeeLogin ? <div className="system-login">
      <span><small>Usuário</small><b>{system.username || "—"}</b>{system.username && <button className="link-button" onClick={() => void copy(system.username!, "Usuário")} title="Copiar usuário" aria-label="Copiar usuário"><Copy size={12} /></button>}</span>
      <span><small>Senha</small>{system.hasPassword ? <>
        <b className="system-password">{password ?? "••••••••"}</b>
        <button className="link-button" disabled={busy} onClick={() => { if (password !== null) setPassword(null); else void run(async () => { setPassword((await post({ action: "revealPassword", systemId: system.id, purpose: "view" })).password ?? ""); }); }} title={password !== null ? "Esconder" : "Mostrar (fica registrado)"} aria-label={password !== null ? "Esconder senha" : "Mostrar senha"}>{password !== null ? <EyeOff size={13} /> : <Eye size={13} />}</button>
        <button className="link-button" disabled={busy} onClick={() => void run(async () => { const value = (await post({ action: "revealPassword", systemId: system.id, purpose: "copy" })).password ?? ""; await copy(value, "Senha"); })} title="Copiar senha (fica registrado)" aria-label="Copiar senha"><Copy size={12} /></button>
      </> : <b className="muted">não cadastrada</b>}</span>
    </div> : <p className="system-locked"><KeyRound size={12} /> {team ? `Login visível só para o time ${team.name} e administradores.` : "Login visível só para administradores."}</p>}
    {system.notes && <p className="system-notes">{system.notes}</p>}
    {system.monitor && <p className={`system-monitor ${system.status}`}>
      {system.status === "down" ? <>Fora do ar{system.lastChangeAt ? ` desde ${relativeTime(system.lastChangeAt)}` : ""}{system.lastError ? ` · ${system.lastError}` : ""}</> : system.status === "up" ? <>No ar{system.lastMs !== null ? ` · ${system.lastMs} ms` : ""}{system.lastCheckedAt ? ` · verificado ${relativeTime(system.lastCheckedAt)}` : ""}</> : "Aguardando a primeira verificação"}
      {uptime !== null && <> · {uptime}% no ar em 30 dias</>}
      {system.events.filter((event) => event.kind === "down").length > 0 && <> · {system.events.filter((event) => event.kind === "down").length} queda(s) no período</>}
    </p>}
    {system.monitor && portWarning(system.url) && <p className="form-hint warn"><TriangleAlert size={11} /> A porta deste endereço pode não ser alcançável pelo servidor do Portal; se aparecer “fora do ar” sem estar, desligue o monitor deste acesso.</p>}
    {message && <p className="system-message">{message}</p>}
  </article>;
}

function ProfileModal({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ contactName: client.contactName, contactEmail: client.contactEmail, contactPhone: client.contactPhone, monthlyHours: client.monthlyHours?.toString().replace(".", ",") ?? "", notes: client.notes });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await post({ action: "saveProfile", clientId: client.id, ...form }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><p className="eyebrow">CLIENTE</p><h2>{client.name}</h2><p>Contato principal, pacote de horas e observações. O nome do cliente se muda em Demandas → Clientes.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Contato principal</span><input autoFocus maxLength={80} value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} placeholder="Nome de quem fala pelo cliente" /></label>
      <label><span>E-mail do contato</span><input type="email" maxLength={120} value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} /></label>
      <label><span>Telefone do contato</span><input maxLength={40} value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} inputMode="tel" /></label>
      <label><span>Pacote de horas por mês <em>opcional</em></span><input inputMode="decimal" value={form.monthlyHours} onChange={(event) => setForm({ ...form, monthlyHours: event.target.value })} placeholder="Ex.: 40" /><small>Avisa na ficha a partir de 80% do pacote.</small></label>
      <label className="full"><span>Observações</span><textarea rows={5} maxLength={4000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Contrato, horário de atendimento, particularidades…" /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar ficha"}</button></div>
  </form></div>;
}

function SystemModal({ clientId, system, teams, onClose, onSaved }: { clientId: number; system: System | null; teams: Detail["teams"]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: system?.name ?? "", environment: system?.environment ?? "demo" as Environment, url: system?.url ?? "", username: system?.username ?? "", password: "", clearPassword: false, teamId: system?.teamId ? String(system.teamId) : String(teams.find((team) => /^suporte/i.test(team.name))?.id ?? ""), notes: system?.notes ?? "", monitor: system?.monitor ?? false });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" autoComplete="off" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await post({ action: "saveSystem", clientId, systemId: system?.id, ...form, teamId: form.teamId ? Number(form.teamId) : null }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><p className="eyebrow">ACESSO DE SISTEMA</p><h2>{system ? "Editar acesso" : "Novo acesso"}</h2><p>A senha fica criptografada. Só o time escolhido e os administradores veem o login, e cada vez que alguém vê ou copia a senha fica registrado no histórico.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Sistema</span><input autoFocus required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: SGE" /></label>
      <label><span>Ambiente</span><select value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value as Environment })}>{ENVIRONMENTS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
      <label className="full"><span>Endereço (URL)</span><input type="url" maxLength={500} value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://cliente.exemplo.com.br/sistema" /></label>
      <label><span>Usuário</span><input maxLength={120} autoComplete="off" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
      <label><span>Senha {system?.hasPassword && <em>deixe em branco para manter</em>}</span><span className="password-field"><input type={showPassword ? "text" : "password"} maxLength={200} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value, clearPassword: false })} placeholder={system?.hasPassword ? "••••••••" : ""} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Esconder" : "Mostrar"}>{showPassword ? <EyeOff size={14} /> : <Eye size={14} />}</button></span>
        {system?.hasPassword && <label className="inline-check"><input type="checkbox" checked={form.clearPassword} onChange={(event) => setForm({ ...form, clearPassword: event.target.checked, password: "" })} /> Apagar a senha guardada</label>}</label>
      <label><span>Quem vê o login</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Só administradores</option>{teams.map((team) => <option key={team.id} value={team.id}>Time {team.name} e administradores</option>)}</select></label>
      <label className="inline-check monitor-check"><input type="checkbox" checked={form.monitor} onChange={(event) => setForm({ ...form, monitor: event.target.checked })} /> <span><b>Monitorar se está no ar</b><small>Verifica a cada 5 minutos e avisa o time no sino quando cair ou voltar.</small></span></label>
      {form.monitor && form.url && portWarning(form.url) && <p className="full form-hint warn"><TriangleAlert size={11} /> A porta deste endereço ({new URL(form.url).port}) pode não ser alcançável pelo servidor do Portal na nuvem. Se aparecer “fora do ar” sem estar, desligue o monitor.</p>}
      <label className="full"><span>Observações <em>opcional</em></span><textarea rows={3} maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Ex.: usar a filial 01; precisa de VPN" /></label>
      <p className="full form-hint">Recomendado para acessos de teste, demonstração e treinamento. Senhas de produção com dados reais, servidores e bancos ficam melhor num cofre próprio (ex.: Bitwarden); aqui você pode anotar só “senha no cofre, item X”.</p>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.name.trim()}>{saving ? "Salvando..." : "Salvar acesso"}</button></div>
  </form></div>;
}

type ClientReport = {
  client: { id: number; name: string; monthlyHours: number | null }; month: string;
  summary: { opened: number; resolved: number; slaPercent: number | null; avgFirstResponseMinutes: number | null; tasksDone: number; hours: number; usage: { percent: number | null; state: string; left: number | null } };
  tickets: { code: string; externalKey: string | null; title: string; status: TicketStatus; urgency: TicketUrgency; createdAt: string; resolvedAt: string | null; assignee: string; firstResponseMinutes: number | null }[];
  tasks: { id: number; title: string; category: string; completedOn: string | null; workedHours: number | null }[];
  entries: { workDate: string; memberName: string; hours: number; note: string; taskId: number; taskTitle: string }[];
};

function downloadClientReport(report: ClientReport) {
  const stamp = (value: string | null) => value ? new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const { summary } = report;
  const slug = report.client.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  downloadXlsx(`relatorio-${slug}-${report.month}.xlsx`, [
    {
      name: "Resumo",
      columns: [{ header: "Indicador", width: 34 }, { header: "Valor", width: 30 }],
      rows: [
        ["Cliente", report.client.name],
        ["Mês", monthLabel(report.month)],
        ["Chamados abertos no mês", summary.opened],
        ["Chamados resolvidos no mês", summary.resolved],
        ["Primeira resposta dentro do prazo", summary.slaPercent === null ? "—" : `${summary.slaPercent}%`],
        ["Tempo médio até a primeira resposta", summary.avgFirstResponseMinutes === null ? "—" : formatMinutes(summary.avgFirstResponseMinutes)],
        ["Demandas entregues", summary.tasksDone],
        ["Horas trabalhadas", formatHours(summary.hours)],
        ["Pacote de horas do mês", report.client.monthlyHours ? formatHours(report.client.monthlyHours) : "Sem pacote"],
        ["Uso do pacote", summary.usage.percent === null ? "—" : `${summary.usage.percent}%`],
        ["Saldo do pacote", summary.usage.left === null ? "—" : summary.usage.left >= 0 ? formatHours(summary.usage.left) : `${formatHours(-summary.usage.left)} acima do pacote`],
      ],
    },
    {
      name: "Chamados",
      columns: [{ header: "Código", width: 12 }, { header: "Título", width: 50 }, { header: "Urgência", width: 10 }, { header: "Status", width: 15 }, { header: "Aberto em", width: 17 }, { header: "Resolvido em", width: 17 }, { header: "1ª resposta (min)", type: "number", width: 15 }, { header: "Responsável", width: 20 }],
      rows: report.tickets.map((ticket) => [ticket.externalKey ?? ticket.code, ticket.title, ticketUrgencyLabels[ticket.urgency], ticketStatusLabels[ticket.status], stamp(ticket.createdAt), stamp(ticket.resolvedAt), ticket.firstResponseMinutes, ticket.assignee]),
    },
    {
      name: "Demandas entregues",
      columns: [{ header: "Código", width: 11 }, { header: "Demanda", width: 55 }, { header: "Categoria", width: 16 }, { header: "Concluída em", type: "date", width: 13 }, { header: "Horas totais", type: "number", width: 12 }],
      rows: report.tasks.map((task) => [taskCode(task.id), task.title, task.category, task.completedOn, task.workedHours]),
    },
    {
      name: "Horas",
      columns: [{ header: "Dia", type: "date", width: 12 }, { header: "Pessoa", width: 22 }, { header: "Demanda", width: 50 }, { header: "Horas", type: "number", width: 9 }, { header: "O que foi feito", width: 50 }],
      rows: report.entries.map((entry) => [entry.workDate, entry.memberName, `${taskCode(entry.taskId)} ${entry.taskTitle}`, entry.hours, entry.note]),
    },
  ]);
}

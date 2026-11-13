"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CalendarRange from "lucide-react/icons/calendar-range";
import Check from "lucide-react/icons/check";
import ListTodo from "lucide-react/icons/list-todo";
import Lock from "lucide-react/icons/lock";
import MessagesSquare from "lucide-react/icons/messages-square";
import Pencil from "lucide-react/icons/pencil";
import Play from "lucide-react/icons/play";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import ThumbsUp from "lucide-react/icons/thumbs-up";
import Trash2 from "lucide-react/icons/trash-2";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import X from "lucide-react/icons/x";
import { burndown, RETRO_COLUMNS, sprintCapacity, type RetroKind } from "./office-tools";
import { formatHours } from "./time-entries";
import { taskCode, taskStatusLabels, type TaskStatus } from "./tasks";
import { Avatar, relativeTime } from "./task-shared";

type Me = { id: number; canEdit: boolean; isAdmin: boolean };
type Team = { id: number; name: string; color?: string };
type Sprint = { id: number; name: string; teamId: number | null; startDate: string; endDate: string; goal: string; hoursPerDay: number; status: "planned" | "active" | "closed"; total: number; done: number; estimate: number };
type SprintTask = { id: number; title: string; status: TaskStatus; priority: number; estimatedHours: number | null; workedHours: number | null; completedOn: string | null; dueDate: string | null; owners: number[] };
type Person = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
type SprintDetail = { sprint: Sprint; tasks: SprintTask[]; memberIds: number[]; absences: { memberId: number; startDate: string; endDate: string }[]; members: Person[]; backlog: { id: number; title: string; status: TaskStatus; estimatedHours: number | null }[]; me: Me };

const statusLabels = { planned: "Planejado", active: "Em andamento", closed: "Encerrado" } as const;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

async function call(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

export default function SprintsView({ onOpenTask }: { onOpenTask: (taskId: number) => void }) {
  const [tab, setTab] = useState<"sprints" | "retros">("sprints");
  return <div className="sprints-page">
    <div className="tasks-scope" role="tablist" aria-label="Seções">
      <button role="tab" aria-selected={tab === "sprints"} className={tab === "sprints" ? "active" : ""} onClick={() => setTab("sprints")}><CalendarRange size={14} /> Sprints</button>
      <button role="tab" aria-selected={tab === "retros"} className={tab === "retros" ? "active" : ""} onClick={() => setTab("retros")}><MessagesSquare size={14} /> Retrospectivas</button>
    </div>
    {tab === "sprints" ? <SprintsTab onOpenTask={onOpenTask} /> : <RetrosTab onOpenTask={onOpenTask} />}
  </div>;
}

// ---------------- Sprints ----------------

function SprintsTab({ onOpenTask }: { onOpenTask: (taskId: number) => void }) {
  const [data, setData] = useState<{ sprints: Sprint[]; teams: Team[]; me: Me } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Sprint | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/sprints", { cache: "no-store" });
      const json = await response.json() as { sprints: Sprint[]; teams: Team[]; me: Me; error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar os sprints.");
      setData(json);
      setSelected((current) => current ?? json.sprints.find((sprint) => sprint.status === "active")?.id ?? json.sprints[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os sprints.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  return <div className="sprints-layout">
    <aside className="sprints-list">
      {data.me.canEdit && <button className="primary-button" onClick={() => setEditing("new")}><Plus size={15} /> Novo sprint</button>}
      {data.sprints.length ? <ul>{data.sprints.map((sprint) => <li key={sprint.id}><button className={selected === sprint.id ? "active" : ""} onClick={() => setSelected(sprint.id)}>
        <span><strong>{sprint.name}</strong><em className={`sprint-status ${sprint.status}`}>{statusLabels[sprint.status]}</em></span>
        <small>{shortDate(sprint.startDate)} a {shortDate(sprint.endDate)}{sprint.teamId ? ` · ${data.teams.find((team) => team.id === sprint.teamId)?.name ?? ""}` : ""}</small>
        <i className="sprint-progress"><b style={{ width: `${sprint.total ? (sprint.done / sprint.total) * 100 : 0}%` }} /></i>
        <small>{sprint.done} de {sprint.total} concluídas</small>
      </button></li>)}</ul> : <p className="muted">Nenhum sprint ainda. Um sprint é um período curto (1 ou 2 semanas) com as demandas que o time se compromete a entregar.</p>}
    </aside>
    {selected ? <SprintDetailPanel key={selected} sprintId={selected} sprints={data.sprints} teams={data.teams} onOpenTask={onOpenTask} onEdit={(sprint) => setEditing(sprint)} onChanged={load} onDeleted={async () => { setSelected(null); await load(); }} /> : <div className="empty-state"><span><CalendarRange /></span><h3>Crie o primeiro sprint</h3><p>Escolha o time, o período e as demandas. O Portal calcula a capacidade (descontando férias e folgas) e desenha o gráfico de queima.</p></div>}
    {editing && <SprintModal sprint={editing === "new" ? null : editing} teams={data.teams} onClose={() => setEditing(null)} onSaved={async (id) => { setEditing(null); await load(); setSelected(id); }} />}
  </div>;
}

function SprintDetailPanel({ sprintId, sprints, teams, onOpenTask, onEdit, onChanged, onDeleted }: { sprintId: number; sprints: Sprint[]; teams: Team[]; onOpenTask: (taskId: number) => void; onEdit: (sprint: Sprint) => void; onChanged: () => Promise<void>; onDeleted: () => Promise<void> }) {
  const [detail, setDetail] = useState<SprintDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/sprints?sprintId=${sprintId}`, { cache: "no-store" });
      const json = await response.json() as SprintDetail & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar o sprint.");
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o sprint.");
    }
  }, [sprintId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function run(payload: Record<string, unknown>) {
    setError("");
    try { await call("/api/sprints", payload); await Promise.all([load(), onChanged()]); return true; } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); return false; }
  }

  const now = today();
  const capacity = useMemo(() => detail ? sprintCapacity({ memberIds: detail.memberIds, absences: detail.absences, start: detail.sprint.startDate, end: detail.sprint.endDate, hoursPerDay: detail.sprint.hoursPerDay }) : null, [detail]);
  const chart = useMemo(() => detail ? burndown(detail.tasks, detail.sprint.startDate, detail.sprint.endDate, now) : [], [detail, now]);
  if (!detail || !capacity) return <section className="sprint-detail">{error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>}</section>;

  const { sprint, me } = detail;
  const team = teams.find((entry) => entry.id === sprint.teamId);
  const planned = detail.tasks.filter((task) => task.status !== "canceled").reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
  const withoutEstimate = detail.tasks.filter((task) => task.status !== "canceled" && !task.estimatedHours).length;
  const done = detail.tasks.filter((task) => task.status === "done").length;
  const membersById = new Map(detail.members.map((person) => [person.id, person]));
  const groups = (["in_progress", "in_review", "todo", "backlog", "waiting", "blocked", "paused", "done", "canceled"] as TaskStatus[]).map((status) => ({ status, tasks: detail.tasks.filter((task) => task.status === status) })).filter((group) => group.tasks.length);

  return <section className="sprint-detail">
    <header className="sprint-head">
      <div><h2>{sprint.name} <em className={`sprint-status ${sprint.status}`}>{statusLabels[sprint.status]}</em></h2>
        <p>{shortDate(sprint.startDate)} a {shortDate(sprint.endDate)} · {capacity.workingDays} dias úteis{team ? ` · time ${team.name}` : " · sem time"}</p>
        {sprint.goal && <p className="sprint-goal"><b>Objetivo:</b> {sprint.goal}</p>}</div>
      {me.canEdit && <div className="sprint-actions">
        {sprint.status === "planned" && <button className="primary-button" onClick={() => void run({ action: "startSprint", sprintId })}><Play size={14} /> Começar</button>}
        {sprint.status !== "closed" && <button className="secondary-button" onClick={() => setClosing(true)}><Check size={14} /> Encerrar</button>}
        <button className="person-edit" onClick={() => onEdit(sprint)} title="Editar sprint" aria-label="Editar sprint"><Pencil size={14} /></button>
        {me.isAdmin && <button className="person-edit" onClick={async () => { if (window.confirm(`Excluir ${sprint.name}? As demandas continuam existindo, só saem do sprint.`) && await run({ action: "deleteSprint", sprintId })) await onDeleted(); }} title="Excluir sprint" aria-label="Excluir sprint"><Trash2 size={14} /></button>}
      </div>}
    </header>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    <div className="client-stats sprint-stats">
      <article><small>Demandas</small><strong>{done}/{detail.tasks.length}</strong><span>concluídas</span></article>
      <article className={planned > capacity.hours && capacity.hours > 0 ? "usage-over" : ""}><small>Planejado × capacidade</small><strong>{formatHours(planned)}</strong>
        <span>{capacity.hours ? <>de {formatHours(capacity.hours)} disponíveis ({detail.memberIds.length} pessoa{detail.memberIds.length === 1 ? "" : "s"} × {sprint.hoursPerDay} h/dia, sem as ausências)</> : "Escolha um time com pessoas para calcular a capacidade"}</span>
        {capacity.hours > 0 && <i className="usage-bar"><b style={{ width: `${Math.min(100, (planned / capacity.hours) * 100)}%` }} /></i>}</article>
      <article><small>Sem estimativa</small><strong>{withoutEstimate}</strong><span>{withoutEstimate ? "estime as horas para o gráfico ficar fiel" : "todas estimadas"}</span></article>
    </div>
    {planned > capacity.hours && capacity.hours > 0 && <p className="hours-warning"><TriangleAlert size={14} /> O planejado passa da capacidade do time em {formatHours(planned - capacity.hours)}. Vale tirar alguma demanda ou rever as estimativas.</p>}
    {capacity.perPerson.some((person) => person.days < capacity.workingDays) && <p className="sprint-away">Ausências no período: {capacity.perPerson.filter((person) => person.days < capacity.workingDays).map((person) => `${membersById.get(person.memberId)?.name.split(" ")[0] ?? "Alguém"} (${capacity.workingDays - person.days} dia${capacity.workingDays - person.days === 1 ? "" : "s"})`).join(", ")}</p>}

    <section className="client-section">
      <header><h3>Gráfico de queima</h3><span className="chart-legend"><i className="ideal" /> ideal <i className="real" /> horas que faltam</span></header>
      <BurndownChart points={chart} />
    </section>

    <section className="client-section">
      <header><h3><ListTodo size={15} /> Demandas do sprint</h3>{me.canEdit && sprint.status !== "closed" && <button className="secondary-button" onClick={() => setAdding(true)}><Plus size={14} /> Adicionar demandas</button>}</header>
      {groups.length ? groups.map((group) => <div key={group.status} className="sprint-group">
        <p className="dep-label">{taskStatusLabels[group.status]} · {group.tasks.length}</p>
        <ul className="client-links">{group.tasks.map((task) => <li key={task.id}><button onClick={() => onOpenTask(task.id)}><span className="task-code">{taskCode(task.id)}</span><span className="client-link-title">{task.title}</span><span className="sprint-task-hours">{task.estimatedHours ? formatHours(task.estimatedHours) : "sem estimativa"}</span><span className="avatar-row">{task.owners.slice(0, 3).map((id) => <Avatar key={id} member={membersById.get(id)} size={20} />)}</span></button>
          {me.canEdit && sprint.status !== "closed" && <button className="dep-remove" onClick={() => void run({ action: "removeTask", taskId: task.id })} title="Tirar do sprint" aria-label={`Tirar ${taskCode(task.id)} do sprint`}><X size={12} /></button>}</li>)}</ul>
      </div>) : <p className="muted">Nenhuma demanda no sprint. Use “Adicionar demandas” ou escolha o sprint dentro da demanda.</p>}
    </section>

    {adding && <AddTasksModal backlog={detail.backlog} onClose={() => setAdding(false)} onAdd={async (ids) => { if (await run({ action: "addTasks", sprintId, taskIds: ids })) setAdding(false); }} />}
    {closing && <CloseSprintModal sprint={sprint} open={detail.tasks.filter((task) => task.status !== "done" && task.status !== "canceled").length} others={sprints.filter((entry) => entry.id !== sprintId && entry.status !== "closed")} onClose={() => setClosing(false)} onConfirm={async (moveTo) => { if (await run({ action: "closeSprint", sprintId, moveTo })) setClosing(false); }} />}
  </section>;
}

/** Linha ideal (tracejada) e horas que faltam (sólida), por dia útil. */
function BurndownChart({ points }: { points: { day: string; ideal: number; remaining: number | null }[] }) {
  if (!points.length) return <p className="muted">Sem dias úteis no período.</p>;
  if (!points[0].ideal) return <p className="muted">Estime as horas das demandas do sprint (campo “Horas estimadas” na demanda) para o gráfico mostrar quanto falta a cada dia.</p>;
  const width = 640, height = 200, left = 40, right = 12, top = 12, bottom = 28;
  const max = Math.max(1, ...points.map((point) => Math.max(point.ideal, point.remaining ?? 0)));
  const x = (index: number) => left + (points.length === 1 ? 0 : (index * (width - left - right)) / (points.length - 1));
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  const ideal = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.ideal).toFixed(1)}`).join(" ");
  const real = points.flatMap((point, index) => point.remaining === null ? [] : [`${x(index).toFixed(1)},${y(point.remaining).toFixed(1)}`]);
  const ticks = [...new Set([0, 0.5, 1].map((share) => Math.round(max * share)))];
  const step = Math.max(1, Math.ceil(points.length / 8));
  return <svg className="burndown" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Gráfico de queima: começa com ${points[0].ideal} horas; hoje faltam ${[...points].reverse().find((point) => point.remaining !== null)?.remaining ?? points[0].ideal} horas.`}>
    {ticks.map((tick) => <g key={tick}><line className="grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text className="axis" x={left - 6} y={y(tick) + 4} textAnchor="end">{tick}h</text></g>)}
    {points.map((point, index) => index % step === 0 || index === points.length - 1 ? <text key={point.day} className="axis" x={x(index)} y={height - 8} textAnchor="middle">{shortDate(point.day)}</text> : null)}
    <path className="ideal" d={ideal} />
    {real.length > 1 && <polyline className="real" points={real.join(" ")} />}
    {real.map((point, index) => { const [cx, cy] = point.split(","); return <circle key={index} className="real-dot" cx={cx} cy={cy} r={3} />; })}
  </svg>;
}

function SprintModal({ sprint, teams, onClose, onSaved }: { sprint: Sprint | null; teams: Team[]; onClose: () => void; onSaved: (id: number) => void }) {
  const start = today();
  const [form, setForm] = useState({ name: sprint?.name ?? "", teamId: sprint?.teamId ? String(sprint.teamId) : "", startDate: sprint?.startDate ?? start, endDate: sprint?.endDate ?? new Date(Date.parse(`${start}T12:00:00Z`) + 13 * 86400000).toISOString().slice(0, 10), goal: sprint?.goal ?? "", hoursPerDay: String(sprint?.hoursPerDay ?? 6).replace(".", ",") });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { const result = await call("/api/sprints", { action: "saveSprint", sprintId: sprint?.id, ...form, teamId: form.teamId ? Number(form.teamId) : null }) as { sprint?: { id: number } }; onSaved(result.sprint?.id ?? sprint?.id ?? 0); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>{sprint ? "Editar sprint" : "Novo sprint"}</h2><p>Período curto com as demandas que o time se compromete a entregar.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Nome</span><input autoFocus required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Sprint 12" /></label>
      <label><span>Time</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Sem time</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label><span>Início</span><input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
      <label><span>Fim</span><input type="date" required value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
      <label><span>Horas por dia de cada pessoa</span><input inputMode="decimal" value={form.hoursPerDay} onChange={(event) => setForm({ ...form, hoursPerDay: event.target.value })} /><small>Tempo realmente dedicado às demandas (descontando reuniões e suporte).</small></label>
      <label className="full"><span>Objetivo <em>opcional</em></span><textarea rows={2} maxLength={1000} value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} placeholder="Ex.: Entregar o módulo de boletos para homologação" /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.name.trim()}>{saving ? "Salvando..." : "Salvar sprint"}</button></div>
  </form></div>;
}

function AddTasksModal({ backlog, onClose, onAdd }: { backlog: SprintDetail["backlog"]; onClose: () => void; onAdd: (ids: number[]) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const needle = fold(query.trim()).replace(/^dem-?0*/, "");
  const list = backlog.filter((task) => !needle || fold(task.title).includes(needle) || String(task.id) === needle).slice(0, 80);
  const hours = backlog.filter((task) => picked.includes(task.id)).reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal add-tasks-modal">
    <div className="modal-head"><div><h2>Adicionar demandas</h2><p>Demandas em aberto que ainda não estão em nenhum sprint (do time do sprint ou sem time).</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <label className="tasks-search"><Search size={14} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Código ou parte do título" /></label>
    <ul className="pick-list">{list.map((task) => <li key={task.id}><label><input type="checkbox" checked={picked.includes(task.id)} onChange={(event) => setPicked((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} /><span className="task-code">{taskCode(task.id)}</span><span>{task.title}</span><small>{task.estimatedHours ? formatHours(task.estimatedHours) : "—"}</small></label></li>)}</ul>
    {!list.length && <p className="muted">Nada encontrado.</p>}
    <div className="modal-actions"><span className="muted">{picked.length} escolhida{picked.length === 1 ? "" : "s"}{hours ? ` · ${formatHours(hours)} estimadas` : ""}</span><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy || !picked.length} onClick={async () => { setBusy(true); await onAdd(picked); setBusy(false); }}>Adicionar</button></div>
  </div></div>;
}

function CloseSprintModal({ sprint, open, others, onClose, onConfirm }: { sprint: Sprint; open: number; others: Sprint[]; onClose: () => void; onConfirm: (moveTo: number | null) => Promise<void> }) {
  const [moveTo, setMoveTo] = useState(others.find((entry) => entry.status === "planned")?.id ? String(others.find((entry) => entry.status === "planned")!.id) : "");
  const [busy, setBusy] = useState(false);
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal">
    <div className="modal-head"><div><h2>Encerrar {sprint.name}</h2><p>{open ? `${open} demanda${open === 1 ? "" : "s"} não terminou${open === 1 ? "" : "aram"}. Para onde ${open === 1 ? "ela vai" : "elas vão"}?` : "Todas as demandas foram concluídas."}</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    {open > 0 && <div className="form-grid"><label className="full"><span>Demandas não concluídas</span><select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}><option value="">Voltam para a lista geral (sem sprint)</option>{others.map((entry) => <option key={entry.id} value={entry.id}>Vão para {entry.name}</option>)}</select></label></div>}
    <p className="form-hint">Depois de encerrar, dá para registrar a retrospectiva na aba Retrospectivas.</p>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(moveTo ? Number(moveTo) : null); setBusy(false); }}>Encerrar sprint</button></div>
  </div></div>;
}

// ---------------- Retrospectivas ----------------

type RetroSummary = { id: number; title: string; teamId: number | null; sprintId: number | null; anonymous: boolean; status: "open" | "closed"; createdByName: string; createdAt: string; items: number; actions: number };
type RetroItem = { id: number; kind: RetroKind; text: string; taskId: number | null; createdAt: string; authorName: string; mine: boolean; votes: number; votedByMe: boolean };
type RetroDetail = { retro: RetroSummary & { canManage: boolean }; items: RetroItem[]; me: Me };

function RetrosTab({ onOpenTask }: { onOpenTask: (taskId: number) => void }) {
  const [data, setData] = useState<{ retros: RetroSummary[]; teams: Team[]; sprints: { id: number; name: string; status: string }[]; me: Me } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/retros", { cache: "no-store" });
      const json = await response.json() as NonNullable<typeof data> & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar as retrospectivas.");
      setData(json);
      setSelected((current) => current ?? json.retros[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as retrospectivas.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  return <div className="sprints-layout">
    <aside className="sprints-list">
      {data.me.canEdit && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Nova retrospectiva</button>}
      {data.retros.length ? <ul>{data.retros.map((retro) => <li key={retro.id}><button className={selected === retro.id ? "active" : ""} onClick={() => setSelected(retro.id)}>
        <span><strong>{retro.title}</strong>{retro.status === "closed" ? <em className="sprint-status closed">Encerrada</em> : <em className="sprint-status active">Aberta</em>}</span>
        <small>{retro.items} ite{retro.items === 1 ? "m" : "ns"} · {retro.actions} aç{retro.actions === 1 ? "ão" : "ões"}{retro.anonymous ? " · anônima" : ""} · {relativeTime(retro.createdAt)}</small>
      </button></li>)}</ul> : <p className="muted">Nenhuma retrospectiva ainda. No fim de cada sprint (ou do mês), o time anota o que foi bem, o que melhorar e as ações.</p>}
    </aside>
    {selected ? <RetroBoard key={selected} retroId={selected} onOpenTask={onOpenTask} onChanged={load} onDeleted={async () => { setSelected(null); await load(); }} /> : <div className="empty-state"><span><MessagesSquare /></span><h3>Comece uma retrospectiva</h3><p>Cada pessoa escreve nas três colunas e vota no que mais importa. As ações podem virar demandas com um clique.</p></div>}
    {creating && <NewRetroModal teams={data.teams} sprints={data.sprints} onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await load(); setSelected(id); }} />}
  </div>;
}

function RetroBoard({ retroId, onOpenTask, onChanged, onDeleted }: { retroId: number; onOpenTask: (taskId: number) => void; onChanged: () => Promise<void>; onDeleted: () => Promise<void> }) {
  const [detail, setDetail] = useState<RetroDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<RetroKind, string>>({ good: "", improve: "", action: "" });
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/retros?retroId=${retroId}`, { cache: "no-store" });
      const json = await response.json() as RetroDetail & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar a retrospectiva.");
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a retrospectiva.");
    }
  }, [retroId]);
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    // Durante a reunião, todos veem os itens novos.
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);

  async function run(payload: Record<string, unknown>) {
    setError("");
    try { const result = await call("/api/retros", { retroId, ...payload }); await load(); return result; } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); return null; }
  }

  if (!detail) return <section className="sprint-detail">{error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>}</section>;
  const { retro, me } = detail;
  const open = retro.status === "open";
  return <section className="sprint-detail">
    <header className="sprint-head">
      <div><h2>{retro.title} <em className={`sprint-status ${open ? "active" : "closed"}`}>{open ? "Aberta" : "Encerrada"}</em></h2>
        <p>Criada por {retro.createdByName} · {relativeTime(retro.createdAt)}{retro.anonymous ? <> · <Lock size={11} /> anônima: ninguém vê quem escreveu</> : ""}</p></div>
      <div className="sprint-actions">
        {retro.canManage && <button className="secondary-button" onClick={async () => { await run({ action: open ? "closeRetro" : "reopenRetro" }); await onChanged(); }}>{open ? <><Check size={14} /> Encerrar</> : "Reabrir"}</button>}
        {me.isAdmin && <button className="person-edit" onClick={async () => { if (window.confirm(`Excluir “${retro.title}” e todos os itens?`) && await run({ action: "deleteRetro" })) await onDeleted(); }} title="Excluir" aria-label="Excluir retrospectiva"><Trash2 size={14} /></button>}
      </div>
    </header>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    <div className="retro-board">
      {RETRO_COLUMNS.map((column) => <section key={column.kind} className={`retro-column ${column.kind}`}>
        <header><strong>{column.label}</strong><small>{column.hint}</small></header>
        {open && me.canEdit && <form onSubmit={async (event) => { event.preventDefault(); if (!drafts[column.kind].trim()) return; if (await run({ action: "addItem", kind: column.kind, text: drafts[column.kind] })) setDrafts({ ...drafts, [column.kind]: "" }); }}>
          <textarea rows={2} maxLength={500} value={drafts[column.kind]} onChange={(event) => setDrafts({ ...drafts, [column.kind]: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Escreva e Enter" aria-label={`Novo item em ${column.label}`} />
        </form>}
        <ul>{detail.items.filter((item) => item.kind === column.kind).map((item) => <li key={item.id} className={item.mine ? "mine" : ""}>
          <p>{item.text}</p>
          <footer>
            <button className={`retro-vote ${item.votedByMe ? "on" : ""}`} disabled={!open || !me.canEdit} onClick={() => void run({ action: "vote", itemId: item.id, on: !item.votedByMe })} aria-pressed={item.votedByMe} title={item.votedByMe ? "Tirar meu voto" : "Votar"}><ThumbsUp size={12} /> {item.votes}</button>
            {item.authorName && <small>{item.authorName.split(" ")[0]}</small>}
            {item.kind === "action" && (item.taskId ? <button className="link-button" onClick={() => onOpenTask(item.taskId!)}>{taskCode(item.taskId)}</button> : me.canEdit && <button className="link-button" onClick={async () => { const result = await run({ action: "itemToTask", itemId: item.id }) as { taskId?: number } | null; if (result?.taskId && window.confirm(`Demanda ${taskCode(result.taskId)} criada. Abrir agora?`)) onOpenTask(result.taskId); }}>Virar demanda</button>)}
            {(item.mine || retro.canManage) && me.canEdit && <button className="dep-remove" onClick={() => { if (window.confirm("Apagar este item?")) void run({ action: "deleteItem", itemId: item.id }); }} title="Apagar" aria-label="Apagar item"><Trash2 size={12} /></button>}
          </footer>
        </li>)}</ul>
      </section>)}
    </div>
  </section>;
}

function NewRetroModal({ teams, sprints, onClose, onCreated }: { teams: Team[]; sprints: { id: number; name: string; status: string }[]; onClose: () => void; onCreated: (id: number) => void }) {
  const [form, setForm] = useState({ title: "", teamId: "", sprintId: "", anonymous: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { const result = await call("/api/retros", { action: "createRetro", ...form, teamId: form.teamId ? Number(form.teamId) : null, sprintId: form.sprintId ? Number(form.sprintId) : null }) as { id: number }; onCreated(result.id); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível criar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>Nova retrospectiva</h2><p>O que foi bem, o que melhorar e as ações. Todos escrevem e votam.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Título</span><input autoFocus required maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Retrospectiva do Sprint 12" /></label>
      <label><span>Time</span><select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Toda a equipe</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label><span>Sprint <em>opcional</em></span><select value={form.sprintId} onChange={(event) => { const sprint = sprints.find((entry) => String(entry.id) === event.target.value); setForm({ ...form, sprintId: event.target.value, title: form.title || (sprint ? `Retrospectiva do ${sprint.name}` : "") }); }}><option value="">Nenhum</option>{sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}</select></label>
      <label className="inline-check full"><input type="checkbox" checked={form.anonymous} onChange={(event) => setForm({ ...form, anonymous: event.target.checked })} /> <span><b>Anônima</b><small>Ninguém vê quem escreveu cada item (nem administradores). Cada pessoa ainda pode apagar o que escreveu.</small></span></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.title.trim()}>{saving ? "Criando..." : "Criar"}</button></div>
  </form></div>;
}

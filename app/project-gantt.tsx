"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import Diamond from "lucide-react/icons/diamond";
import Link2 from "lucide-react/icons/link-2";
import Plus from "lucide-react/icons/plus";
import Trash2 from "lucide-react/icons/trash-2";
import { barFor, dayLeft, daysPerPercent, dependencyConflict, dragDates, effectiveStart, isDay, timelineRange, wouldCreateCycle } from "./project-timeline";

export type Milestone = { id: number; title: string; date: string; done: boolean };
export type GanttProject = { id: number; name: string; code: string; subtitle: string; farol: string; startDate: string | null; endForecast: string; closed: boolean; milestones: Milestone[]; dependsOn: number[] };

const ROW = 50;
const fullDate = (value: string) => value.split("-").reverse().join("/");
const monthName = (day: string) => { const name = new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", ""); return name.charAt(0).toLocaleUpperCase("pt-BR") + name.slice(1); };

type Drag = { id: number; kind: "move" | "start" | "end"; x: number; width: number; startDate: string; endDate: string; preview: { startDate: string; endDate: string } | null };

/**
 * Linha do tempo dos projetos (Gantt): barras do início à previsão de término, entregas (losangos)
 * e setas das dependências. Quem pode editar arrasta a barra para mudar as datas.
 */
export default function ProjectGantt({ projects, canEdit, onOpen, onMove }: { projects: GanttProject[]; canEdit: boolean; onOpen: (id: number) => void; onMove: (id: number, startDate: string, endDate: string) => Promise<void> }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const moved = useRef(false);

  const items = useMemo(() => projects.map((project) => ({ project, timeline: { id: project.id, startDate: project.startDate, endForecast: project.endForecast, closed: project.closed } })), [projects]);
  const range = useMemo(() => timelineRange(items.map((item) => item.timeline), today), [items, today]);
  const dated = useMemo(() => items.filter((item) => barFor(item.timeline, range, today)).sort((a, b) => (effectiveStart(a.project) ?? "").localeCompare(effectiveStart(b.project) ?? "") || a.project.endForecast.localeCompare(b.project.endForecast)), [items, range, today]);
  const undated = items.filter((item) => !barFor(item.timeline, range, today));
  const rowOf = new Map(dated.map((item, index) => [item.project.id, index]));
  const byId = new Map(projects.map((project) => [project.id, project]));

  // Datas mostradas: as do arraste em andamento ou as salvas.
  const datesOf = (project: GanttProject) => drag?.id === project.id && drag.preview ? { startDate: drag.preview.startDate, endForecast: drag.preview.endDate } : { startDate: project.startDate, endForecast: project.endForecast };

  function begin(event: React.PointerEvent, project: GanttProject, kind: Drag["kind"]) {
    if (!canEdit || saving) return;
    const track = (event.currentTarget as HTMLElement).closest(".gantt-track") as HTMLElement | null;
    const start = effectiveStart(project);
    if (!track || !start || !isDay(project.endForecast)) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    moved.current = false;
    setDrag({ id: project.id, kind, x: event.clientX, width: track.getBoundingClientRect().width, startDate: start, endDate: project.endForecast, preview: null });
  }
  function update(event: React.PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 3) moved.current = true;
    const deltaDays = (dx / drag.width) * 100 * daysPerPercent(range);
    setDrag({ ...drag, preview: dragDates(drag.kind, drag.startDate, drag.endDate, deltaDays) });
  }
  async function finish(project: GanttProject) {
    const current = drag;
    setDrag(null);
    if (!current) return;
    if (!moved.current || !current.preview) { onOpen(project.id); return; }
    const { startDate, endDate } = current.preview;
    if (startDate === current.startDate && endDate === current.endDate && isDay(project.startDate)) return;
    setSaving(project.id);
    try { await onMove(project.id, startDate, endDate); } finally { setSaving(null); }
  }

  // Setas das dependências (de onde termina o projeto anterior até onde começa o seguinte).
  const arrows = dated.flatMap(({ project }) => project.dependsOn.flatMap((dependsOnId) => {
    const before = byId.get(dependsOnId);
    const fromRow = rowOf.get(dependsOnId);
    const toRow = rowOf.get(project.id);
    if (!before || fromRow === undefined || toRow === undefined) return [];
    const fromDates = datesOf(before);
    const toDates = datesOf(project);
    const toStart = effectiveStart(toDates);
    if (!isDay(fromDates.endForecast) || !toStart) return [];
    const x1 = Math.min(100, Math.max(0, dayLeft(fromDates.endForecast, range) + 100 / ((Date.parse(`${range.to}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86400000)));
    const x2 = Math.min(100, Math.max(0, dayLeft(toStart, range)));
    return [{ key: `${dependsOnId}-${project.id}`, x1, y1: fromRow * ROW + ROW / 2, x2, y2: toRow * ROW + ROW / 2, conflict: dependencyConflict(toDates, fromDates), toRow }];
  }));

  return <div className="timeline">
    <div className="timeline-grid gantt">
      <div className="gantt-head"><span /><div className="timeline-months">{range.months.map((month) => <span key={month.day} style={{ left: `${month.left}%` }}>{monthName(month.day)}{month.day.slice(5, 7) === "01" || month === range.months[0] ? ` ${month.day.slice(2, 4)}` : ""}</span>)}</div></div>
      <div className="gantt-body" style={{ gridTemplateRows: `repeat(${Math.max(1, dated.length)}, ${ROW}px)` }}>
        {dated.map(({ project }, index) => {
          const dates = datesOf(project);
          const bar = barFor({ ...project, ...dates, id: project.id, closed: project.closed }, range, today);
          const blockers = project.dependsOn.map((id) => byId.get(id)).filter((entry): entry is GanttProject => Boolean(entry));
          const conflicts = blockers.filter((entry) => dependencyConflict(dates, datesOf(entry)));
          const dragging = drag?.id === project.id && drag.preview;
          return <Fragment key={project.id}>
            <button type="button" className="gantt-name" style={{ gridRow: index + 1 }} onClick={() => onOpen(project.id)} title={project.name}>
              <span className={`farol-dot ${project.farol}`} aria-hidden="true" />
              <span><strong>{project.name}</strong><small>{project.code}{project.subtitle ? ` · ${project.subtitle}` : ""}{conflicts.length > 0 && <em className="gantt-warn" title={`Começa antes de terminar: ${conflicts.map((entry) => entry.name).join(", ")}`}> · depende de projeto não concluído</em>}</small></span>
            </button>
            <div className="gantt-track" style={{ gridRow: index + 1 }}>
              {range.months.map((month) => <i key={month.day} className="timeline-tick" style={{ left: `${month.left}%` }} />)}
              <i className="timeline-today" style={{ left: `${range.todayLeft}%` }} />
              {bar && !bar.outside && <b className={`timeline-bar gantt-bar ${project.farol} ${bar.assumed && !dragging ? "assumed" : ""} ${bar.late ? "late" : ""} ${canEdit ? "editable" : ""} ${drag?.id === project.id ? "dragging" : ""} ${saving === project.id ? "saving" : ""}`}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                title={`${project.name}: ${dates.startDate ? fullDate(dates.startDate) : "início não informado"} a ${fullDate(dates.endForecast)}${canEdit ? " · arraste para mudar as datas" : ""}`}
                onPointerDown={(event) => begin(event, project, "move")} onPointerMove={update} onPointerUp={() => void finish(project)} onPointerCancel={() => setDrag(null)}
                onClick={(event) => { if (!canEdit) { event.stopPropagation(); onOpen(project.id); } }}>
                {canEdit && <span className="gantt-handle start" onPointerDown={(event) => begin(event, project, "start")} onPointerMove={update} onPointerUp={() => void finish(project)} aria-hidden="true" />}
                {canEdit && <span className="gantt-handle end" onPointerDown={(event) => begin(event, project, "end")} onPointerMove={update} onPointerUp={() => void finish(project)} aria-hidden="true" />}
                <em>{dragging ? `${fullDate(dates.startDate ?? "").slice(0, 5)} → ${fullDate(dates.endForecast).slice(0, 5)}` : fullDate(dates.endForecast).slice(0, 5)}</em>
              </b>}
              {project.milestones.filter((milestone) => milestone.date >= range.from && milestone.date < range.to).map((milestone) => <span key={milestone.id} className={`gantt-milestone ${milestone.done ? "done" : milestone.date < today ? "late" : ""}`} style={{ left: `${dayLeft(milestone.date, range)}%` }} title={`${milestone.title} · ${fullDate(milestone.date)}${milestone.done ? " · entregue" : ""}`}><Diamond size={13} /></span>)}
              {arrows.filter((arrow) => arrow.toRow === index).map((arrow) => <span key={arrow.key} className={`gantt-arrowhead ${arrow.conflict ? "conflict" : ""}`} style={{ left: `${arrow.x2}%` }} aria-hidden="true" />)}
            </div>
          </Fragment>;
        })}
        {arrows.length > 0 && <svg className="gantt-links" style={{ gridRow: `1 / span ${dated.length}` }} viewBox={`0 0 100 ${dated.length * ROW}`} preserveAspectRatio="none" aria-hidden="true">
          {arrows.map((arrow) => {
            const midX = arrow.x2 >= arrow.x1 ? (arrow.x1 + arrow.x2) / 2 : arrow.x1;
            return <path key={arrow.key} className={arrow.conflict ? "conflict" : ""} d={arrow.x2 >= arrow.x1 ? `M ${arrow.x1} ${arrow.y1} H ${midX} V ${arrow.y2} H ${arrow.x2}` : `M ${arrow.x1} ${arrow.y1} V ${(arrow.y1 + arrow.y2) / 2} H ${arrow.x2} V ${arrow.y2}`} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>}
      </div>
    </div>
    <p className="timeline-legend"><span><i className="timeline-today" /> hoje</span><span><b className="timeline-bar blue assumed" /> início não informado</span><span><b className="timeline-bar blue late" /> previsão vencida</span><span><Diamond size={12} className="legend-diamond" /> entrega</span><span><Link2 size={12} /> depende de (vermelho: começa antes do outro terminar)</span>{canEdit && <span>Arraste a barra para mudar as datas; puxe as pontas para mudar só o início ou o fim.</span>}</p>
    {undated.length > 0 && <p className="timeline-undated">Sem previsão em data ({undated.length}): {undated.map((item) => item.project.name).join(", ")}. Informe a previsão de término no projeto para aparecer aqui.</p>}
  </div>;
}

/** No projeto: entregas (com data) e de quais projetos ele depende. */
export function ProjectPlanPanel({ project, others, canEdit, onAction }: { project: GanttProject; others: { id: number; name: string; code: string; dependsOn: number[] }[]; canEdit: boolean; onAction: (payload: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [dependency, setDependency] = useState("");
  const [busy, setBusy] = useState(false);
  const edges = others.flatMap((entry) => entry.dependsOn.map((dependsOnId) => ({ projectId: entry.id, dependsOnId }))).concat(project.dependsOn.map((dependsOnId) => ({ projectId: project.id, dependsOnId })));
  const choices = others.filter((entry) => entry.id !== project.id && !project.dependsOn.includes(entry.id) && !wouldCreateCycle(edges, project.id, entry.id));
  const run = async (payload: Record<string, unknown>) => { setBusy(true); try { await onAction({ projectId: project.id, ...payload }); } finally { setBusy(false); } };
  return <div className="project-plan">
    <section>
      <h4><Diamond size={14} /> Entregas</h4>
      {project.milestones.length ? <ul className="plan-milestones">{project.milestones.map((milestone) => <li key={milestone.id} className={milestone.done ? "done" : ""}>
        <label><input type="checkbox" checked={milestone.done} disabled={!canEdit || busy} onChange={(event) => void run({ action: "saveMilestone", milestoneId: milestone.id, title: milestone.title, date: milestone.date, done: event.target.checked })} /><span>{milestone.title}</span></label>
        <small>{fullDate(milestone.date)}</small>
        {canEdit && <button type="button" className="task-drawer-icon" disabled={busy} onClick={() => { if (window.confirm(`Tirar a entrega “${milestone.title}”?`)) void run({ action: "deleteMilestone", milestoneId: milestone.id }); }} aria-label={`Tirar ${milestone.title}`}><Trash2 size={13} /></button>}
      </li>)}</ul> : <p className="muted">Nenhuma entrega marcada.</p>}
      {canEdit && <form className="plan-add" onSubmit={async (event) => { event.preventDefault(); if (!title.trim() || !isDay(date)) return; await run({ action: "saveMilestone", title, date }); setTitle(""); setDate(""); }}>
        <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Homologação com o cliente" aria-label="Nome da entrega" />
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Data da entrega" />
        <button className="secondary-button" disabled={busy || !title.trim() || !isDay(date)}><Plus size={14} /> Adicionar</button>
      </form>}
    </section>
    <section>
      <h4><Link2 size={14} /> Depende de</h4>
      {project.dependsOn.length ? <ul className="plan-deps">{project.dependsOn.map((id) => { const entry = others.find((other) => other.id === id); return entry ? <li key={id}><span>{entry.code} · {entry.name}</span>{canEdit && <button type="button" className="task-drawer-icon" disabled={busy} onClick={() => void run({ action: "removeDependency", dependsOnId: id })} aria-label={`Tirar dependência de ${entry.name}`}><Trash2 size={13} /></button>}</li> : null; })}</ul> : <p className="muted">Não depende de outro projeto.</p>}
      {canEdit && choices.length > 0 && <div className="plan-add">
        <select value={dependency} onChange={(event) => setDependency(event.target.value)} aria-label="Projeto de que este depende"><option value="">Escolha um projeto…</option>{choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.code} · {entry.name}</option>)}</select>
        <button className="secondary-button" disabled={busy || !dependency} onClick={async () => { await run({ action: "addDependency", dependsOnId: Number(dependency) }); setDependency(""); }}><Plus size={14} /> Ligar</button>
      </div>}
    </section>
  </div>;
}

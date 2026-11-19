"use client";

// Grade de carga do time: pessoas nas linhas, próximos dias úteis nas colunas.
// Cada célula mostra as entregas do dia (mais escuro = mais entregas); listrado = pessoa fora (férias, folga).
import { useMemo, useState } from "react";
import { cellLevel, workloadCalendar, type WorkloadAbsence, type WorkloadTask } from "./workload-calendar";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dayHead = (day: string) => ({ weekday: WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()], date: `${day.slice(8, 10)}/${day.slice(5, 7)}` });

export function WorkloadGrid({ tasks, people, absences, today, onOpenTask }: { tasks: WorkloadTask[]; people: { id: number; name: string }[]; absences: WorkloadAbsence[]; today: string; onOpenTask: (taskId: number) => void }) {
  const [range, setRange] = useState<5 | 10>(10);
  const { days, rows } = useMemo(() => workloadCalendar(tasks, absences, today, range), [tasks, absences, today, range]);
  const nameOf = (id: number) => people.find((person) => person.id === id)?.name ?? "Pessoa removida";

  return <section className="report-card workload-grid-card">
    <div className="report-card-head">
      <div><h3>Carga do time por dia</h3><p>Entregas (prazos) de cada pessoa nos próximos dias úteis. Listrado: fora (férias, folga). Clique numa célula para abrir a demanda.</p></div>
      <div className="tasks-scope" role="tablist" aria-label="Período">
        <button role="tab" aria-selected={range === 5} className={range === 5 ? "active" : ""} onClick={() => setRange(5)}>1 semana</button>
        <button role="tab" aria-selected={range === 10} className={range === 10 ? "active" : ""} onClick={() => setRange(10)}>2 semanas</button>
      </div>
    </div>
    {rows.length ? <div className="workload-scroll">
      <table className="workload-grid">
        <thead><tr>
          <th scope="col">Pessoa</th>
          <th scope="col" title="Demandas com prazo vencido">Atrasadas</th>
          {days.map((day) => { const head = dayHead(day); return <th key={day} scope="col" className={day === today ? "today" : ""}><span>{head.weekday}</span>{head.date}</th>; })}
          <th scope="col" title="Todas as demandas em aberto">Em aberto</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.memberId}>
          <th scope="row">{nameOf(row.memberId)}</th>
          <td>{row.overdue.length ? <button className="workload-overdue" onClick={() => onOpenTask(row.overdue[0].id)} title={row.overdue.map((task) => task.title).join("\n")}>{row.overdue.length}</button> : <span className="workload-zero">0</span>}</td>
          {row.cells.map((cell) => {
            const label = `${nameOf(row.memberId)}, ${dayHead(cell.day).date}: ${cell.away ? "fora" : ""}${cell.away && cell.tasks.length ? ", " : ""}${cell.tasks.length ? `${cell.tasks.length} ${cell.tasks.length === 1 ? "entrega" : "entregas"}` : cell.away ? "" : "livre"}`;
            return <td key={cell.day} className={`workload-cell l${cellLevel(cell)} ${cell.away ? "away" : ""} ${cell.day === today ? "today" : ""}`}>
              {cell.tasks.length ? <button onClick={() => onOpenTask(cell.tasks[0].id)} title={`${label}\n${cell.tasks.map((task) => task.title).join("\n")}`} aria-label={label}>{cell.tasks.length}</button> : <span title={label} aria-label={label} />}
            </td>;
          })}
          <td className="workload-open">{row.open}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="muted">Nenhuma demanda em aberto com responsável.</p>}
  </section>;
}

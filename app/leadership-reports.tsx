"use client";

import { useEffect, useMemo, useState } from "react";
import ChevronLeft from "lucide-react/icons/chevron-left";
import ChevronRight from "lucide-react/icons/chevron-right";
import Download from "lucide-react/icons/download";
import { taskCode } from "./tasks";
import { clientReport, monthLabel, monthRange, shiftMonth, type TimeEntry } from "./time-entries";
import { downloadXlsx, type SheetData } from "./xlsx-writer";

export type ReportTask = { id: number; title: string; clientId: number | null; teamId: number | null; status: string; openedOn: string | null; completedOn: string | null; dueDate: string | null; workedHours: number | null };
type Named = { id: number; name: string };

const hoursNumber = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** Lançamentos do mês escolhido (null = não precisa carregar). */
function useMonthEntries(month: string | null) {
  const [state, setState] = useState<{ month: string | null; entries: TimeEntry[] | null; error: string }>({ month: null, entries: null, error: "" });
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    const { from, to } = monthRange(month);
    void (async () => {
      try {
        const response = await fetch(`/api/time-entries?from=${from}&to=${to}`, { cache: "no-store" });
        const data = await response.json() as { entries?: TimeEntry[]; error?: string };
        if (!response.ok || !data.entries) throw new Error(data.error || "Não foi possível carregar as horas.");
        if (!cancelled) setState({ month, entries: data.entries, error: "" });
      } catch (err) {
        if (!cancelled) setState({ month, entries: [], error: err instanceof Error ? err.message : "Não foi possível carregar as horas." });
      }
    })();
    return () => { cancelled = true; };
  }, [month]);
  if (!month) return { entries: [] as TimeEntry[], error: "", loading: false };
  return { entries: state.month === month ? state.entries ?? [] : [], error: state.month === month ? state.error : "", loading: state.month !== month };
}

export function MonthPicker({ month, today, onChange, allowAll }: { month: string | null; today: string; onChange: (month: string | null) => void; allowAll?: boolean }) {
  const current = today.slice(0, 7);
  const shown = month ?? current;
  return <div className="month-picker" role="group" aria-label="Mês">
    {allowAll && <button className={month === null ? "active" : ""} aria-pressed={month === null} onClick={() => onChange(null)}>Tudo</button>}
    <button className="month-step" onClick={() => onChange(shiftMonth(shown, -1))} aria-label="Mês anterior"><ChevronLeft size={15} /></button>
    <button className={month ? "active month-name" : "month-name"} aria-pressed={month !== null} onClick={() => onChange(shown)}>{monthLabel(shown)}</button>
    <button className="month-step" disabled={shown >= current} onClick={() => onChange(shiftMonth(shown, 1))} aria-label="Próximo mês"><ChevronRight size={15} /></button>
  </div>;
}

function entryRows(entries: readonly TimeEntry[], tasksById: Map<number, ReportTask>, clientName: (id: number | null) => string) {
  return [...entries].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.memberName.localeCompare(b.memberName, "pt-BR"))
    .map((entry) => { const task = tasksById.get(entry.taskId); return [entry.workDate, entry.memberName, taskCode(entry.taskId), task?.title ?? "", clientName(task?.clientId ?? null), entry.hours, entry.note]; });
}

const entryColumns = [
  { header: "Data", type: "date" as const, width: 12 }, { header: "Pessoa", width: 22 }, { header: "Demanda", width: 10 }, { header: "Título", width: 48 },
  { header: "Cliente / projeto", width: 22 }, { header: "Horas", type: "number" as const, width: 9 }, { header: "O que foi feito", width: 44 },
];

export function ClientsReport({ tasks, clients, today, teamLabel }: { tasks: ReportTask[]; clients: Named[]; today: string; teamLabel: string }) {
  const [month, setMonth] = useState<string | null>(today.slice(0, 7));
  const { entries, error, loading } = useMonthEntries(month);
  const taskIds = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks]);
  const scopedEntries = useMemo(() => entries.filter((entry) => taskIds.has(entry.taskId)), [entries, taskIds]);
  const rows = useMemo(() => clientReport(tasks, scopedEntries, month, today), [tasks, scopedEntries, month, today]);
  const names = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const clientName = (id: number | null) => (id === null ? "Sem cliente" : names.get(id) ?? "Cliente removido");
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const totals = rows.reduce((sum, row) => ({ opened: sum.opened + row.opened, completed: sum.completed + row.completed, open: sum.open + row.open, overdue: sum.overdue + row.overdue, hours: sum.hours + row.hours, total: sum.total + row.total }), { opened: 0, completed: 0, open: 0, overdue: 0, hours: 0, total: 0 });
  const maxHours = Math.max(...rows.map((row) => row.hours), 1);
  const period = month ? monthLabel(month) : "todo o período";

  function exportExcel() {
    const sheets: SheetData[] = [{
      name: "Clientes",
      columns: month
        ? [{ header: "Cliente / projeto", width: 28 }, { header: "Abertas no mês", type: "number" as const, width: 15 }, { header: "Concluídas no mês", type: "number" as const, width: 17 }, { header: "Em aberto hoje", type: "number" as const, width: 15 }, { header: "Atrasadas hoje", type: "number" as const, width: 15 }, { header: "Horas lançadas no mês", type: "number" as const, width: 20 }]
        : [{ header: "Cliente / projeto", width: 28 }, { header: "Demandas", type: "number" as const, width: 11 }, { header: "Concluídas", type: "number" as const, width: 11 }, { header: "Em aberto hoje", type: "number" as const, width: 15 }, { header: "Atrasadas hoje", type: "number" as const, width: 15 }, { header: "Horas trabalhadas (total)", type: "number" as const, width: 22 }],
      rows: [
        ...rows.map((row) => [clientName(row.clientId), month ? row.opened : row.total, row.completed, row.open, row.overdue, row.hours]),
        ["Total", month ? totals.opened : totals.total, totals.completed, totals.open, totals.overdue, Math.round(totals.hours * 100) / 100],
      ],
    }, {
      name: "Filtros",
      columns: [{ header: "Filtro", width: 20 }, { header: "Valor", width: 40 }],
      rows: [["Período", period], ["Time", teamLabel], ["Exportado em", new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })], ["Observação", month ? "Horas = lançamentos feitos no mês. Horas importadas das planilhas não têm data e só entram em 'Tudo'." : "Horas = total da demanda (anteriores + lançamentos)."]],
    }];
    if (month) sheets.splice(1, 0, { name: "Lançamentos", columns: entryColumns, rows: entryRows(scopedEntries, tasksById, clientName) });
    downloadXlsx(`clientes-${month ?? "tudo"}.xlsx`, sheets);
  }

  return <section className="report-card">
    <div className="report-card-head report-card-toolbar">
      <div><h3>Por cliente · {period}</h3><p>{month ? "Abertas e concluídas no mês, horas lançadas no mês. “Em aberto” e “atrasadas” são a situação de hoje." : "Todas as demandas e o total de horas (anteriores + lançadas)."}</p></div>
      <div className="report-actions"><MonthPicker month={month} today={today} onChange={setMonth} allowAll /><button className="secondary-button" onClick={exportExcel} disabled={loading || !rows.length}><Download size={15} /> Exportar Excel</button></div>
    </div>
    {error && <p className="modal-error">{error}</p>}
    {loading ? <div className="loading-list"><span /><span /></div> : rows.length ? <div className="report-table-wrap"><table className="report-table clients-report">
      <thead><tr><th>Cliente / projeto</th><th>{month ? "Abertas" : "Demandas"}</th><th>Concluídas</th><th>Em aberto</th><th>Atrasadas</th><th>Horas</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.clientId ?? "none"}>
        <td>{clientName(row.clientId)}</td><td>{month ? row.opened : row.total}</td><td>{row.completed}</td><td>{row.open}</td><td className={row.overdue ? "late" : ""}>{row.overdue}</td>
        <td><span className="inline-bar"><i style={{ width: `${(row.hours / maxHours) * 100}%` }} /><b>{hoursNumber.format(row.hours)}</b></span></td>
      </tr>)}</tbody>
      <tfoot><tr><td>Total</td><td>{month ? totals.opened : totals.total}</td><td>{totals.completed}</td><td>{totals.open}</td><td>{totals.overdue}</td><td>{hoursNumber.format(totals.hours)}</td></tr></tfoot>
    </table></div> : <p className="muted">Nada neste período.</p>}
    {month && !loading && <p className="report-footnote">Horas importadas das planilhas não têm data: aparecem só em “Tudo”. A partir de agora, cada lançamento entra no mês em que o trabalho foi feito.</p>}
  </section>;
}

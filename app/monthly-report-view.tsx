"use client";

import { useEffect, useMemo, useState } from "react";
import Download from "lucide-react/icons/download";
import { MonthPicker } from "./leadership-reports";
import { monthlyNumbers, type MonthProject, type MonthTask, type MonthTicket } from "./monthly-report";
import { qualityReport, formatDuration, type QualityTicket } from "./support-quality";
import { satisfactionSummary, type RatedTicket } from "./ticket-rating";
import { firstResponseHours, resolutionHours, ticketCode } from "./tickets";
import { taskCode } from "./tasks";
import { monthLabel } from "./time-entries";
import { downloadXlsx } from "./xlsx-writer";

type TicketRow = MonthTicket & QualityTicket & RatedTicket;
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const pct = (value: number | null) => (value === null ? "—" : percent.format(value));
const fullDate = (day: string | null) => (day ? day.split("-").reverse().join("/") : "—");
const deadlines = { response: firstResponseHours, resolution: resolutionHours };

/** Relatório do mês: um resumo pronto para o fechamento ou a reunião, com Excel completo. */
export default function MonthlyReportView({ tasks, clients, people, teamId, teamLabel, today }: { tasks: MonthTask[]; clients: { id: number; name: string }[]; people: { id: number; name: string }[]; teamId: number | null; teamLabel: string; today: string }) {
  const [month, setMonth] = useState<string | null>(today.slice(0, 7));
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [projects, setProjects] = useState<MonthProject[]>([]);
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [ticketResponse, projectResponse] = await Promise.all([fetch("/api/tickets", { cache: "no-store" }), fetch("/api/projects", { cache: "no-store" })]);
        const ticketData = await ticketResponse.json() as { tickets?: TicketRow[]; error?: string };
        if (!ticketResponse.ok || !ticketData.tickets) throw new Error(ticketData.error || "Não foi possível carregar os chamados.");
        const projectData = projectResponse.ok ? await projectResponse.json() as { projects: MonthProject[] } : { projects: [] };
        if (cancelled) return;
        setTickets(ticketData.tickets);
        setProjects(projectData.projects);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível carregar o relatório.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const chosen = month ?? today.slice(0, 7);
  const clientName = useMemo(() => { const map = new Map(clients.map((client) => [client.id, client.name])); return (id: number | null) => (id === null ? "" : map.get(id) ?? ""); }, [clients]);
  const personName = useMemo(() => { const map = new Map(people.map((person) => [person.id, person.name])); return (id: number | null) => (id === null ? "Sem responsável" : map.get(id) ?? "Pessoa removida"); }, [people]);
  const scopedTickets = useMemo(() => (tickets ?? []).filter((ticket) => teamId === null || ticket.teamId === teamId), [tickets, teamId]);
  const numbers = useMemo(() => monthlyNumbers({ month: chosen, today, tasks, tickets: scopedTickets, projects, clientName }), [chosen, today, tasks, scopedTickets, projects, clientName]);
  const quality = useMemo(() => qualityReport(scopedTickets, { from: numbers.from, to: numbers.to, now, deadlines }), [scopedTickets, numbers, now]);
  const satisfaction = useMemo(() => satisfactionSummary(scopedTickets, numbers.from, numbers.to), [scopedTickets, numbers]);

  if (error) return <div className="alert error"><span>{error}</span></div>;
  if (!tickets) return <div className="loading-list"><span /><span /></div>;

  function exportExcel() {
    const owners = (ids: number[]) => ids.map((id) => personName(id)).join(", ");
    downloadXlsx(`relatorio-${chosen}.xlsx`, [
      { name: "Resumo", columns: [{ header: "Indicador", width: 34 }, { header: "Valor", width: 20 }], rows: [
        ["Mês", monthLabel(chosen)], ["Time", teamLabel],
        ["Demandas abertas", numbers.tasksOpened], ["Demandas entregues", numbers.tasksDelivered], ["Entregues no prazo", pct(numbers.onTimeRate)], ["Demandas atrasadas (fim do mês)", numbers.overdue.length],
        ["Chamados abertos", numbers.ticketsOpened], ["Chamados resolvidos", numbers.ticketsResolved],
        ["1ª resposta no prazo", pct(quality.responseRate)], ["Solução no prazo", pct(quality.resolutionRate)], ["Tempo mediano de solução", formatDuration(quality.medianResolutionMinutes)],
        ["Satisfação (nota média)", satisfaction.average === null ? "—" : satisfaction.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })], ["Satisfeitos (4 e 5)", pct(satisfaction.satisfied)], ["Avaliações", satisfaction.total],
        ["Projetos ativos", numbers.activeProjects], ["Projetos com previsão vencida", numbers.lateProjects.length],
      ] },
      { name: "Por cliente", columns: [{ header: "Cliente", width: 26 }, { header: "Demandas abertas", type: "number", width: 16 }, { header: "Demandas entregues", type: "number", width: 18 }, { header: "Chamados abertos", type: "number", width: 16 }, { header: "Chamados resolvidos", type: "number", width: 18 }],
        rows: numbers.byClient.map((row) => [row.client, row.tasksOpened, row.tasksDelivered, row.ticketsOpened, row.ticketsResolved]) },
      { name: "Entregues", columns: [{ header: "Código", width: 10 }, { header: "Demanda", width: 44 }, { header: "Cliente", width: 20 }, { header: "Responsáveis", width: 28 }, { header: "Prazo", type: "date", width: 12 }, { header: "Entregue em", type: "date", width: 12 }],
        rows: numbers.delivered.map((task) => [taskCode(task.id), task.title, clientName(task.clientId), owners(task.owners), task.dueDate, task.completedOn]) },
      { name: "Atrasadas", columns: [{ header: "Código", width: 10 }, { header: "Demanda", width: 44 }, { header: "Cliente", width: 20 }, { header: "Responsáveis", width: 28 }, { header: "Prazo", type: "date", width: 12 }],
        rows: numbers.overdue.map((task) => [taskCode(task.id), task.title, clientName(task.clientId), owners(task.owners), task.dueDate]) },
      { name: "Satisfação", columns: [{ header: "Responsável", width: 24 }, { header: "Avaliações", type: "number", width: 12 }, { header: "Nota média", type: "number", width: 12 }],
        rows: satisfaction.byPerson.map((row) => [personName(row.assigneeId), row.count, Math.round(row.average * 10) / 10]) },
      { name: "Comentários", columns: [{ header: "Chamado", width: 10 }, { header: "Título", width: 40 }, { header: "Nota", type: "number", width: 8 }, { header: "Comentário", width: 60 }],
        rows: satisfaction.comments.map((entry) => [ticketCode(entry.id), entry.title, entry.rating, entry.comment]) },
    ]);
  }

  return <div className="monthly-report">
    <div className="report-card-toolbar">
      <div><h3>Relatório de {monthLabel(chosen)}</h3><p>{teamLabel}. Demandas, chamados, prazos, satisfação e projetos do mês, prontos para o fechamento.</p></div>
      <div className="report-actions"><MonthPicker month={month} today={today} onChange={setMonth} /><button className="primary-button" onClick={exportExcel}><Download size={15} /> Baixar Excel do mês</button></div>
    </div>

    <div className="leadership-tiles">
      <article><small>Demandas abertas</small><strong>{numbers.tasksOpened}</strong><p>no mês</p></article>
      <article><small>Demandas entregues</small><strong>{numbers.tasksDelivered}</strong><p>{pct(numbers.onTimeRate)} no prazo</p></article>
      <article className={numbers.overdue.length ? "late" : ""}><small>Atrasadas</small><strong>{numbers.overdue.length}</strong><p>{chosen === today.slice(0, 7) ? "hoje" : "no fim do mês"}</p></article>
      <article><small>Chamados</small><strong>{numbers.ticketsOpened}</strong><p>{numbers.ticketsResolved} resolvidos</p></article>
      <article className={quality.resolutionRate !== null && quality.resolutionRate < 0.8 ? "warn" : ""}><small>Solução no prazo</small><strong>{pct(quality.resolutionRate)}</strong><p>1ª resposta {pct(quality.responseRate)}</p></article>
      <article><small>Satisfação</small><strong>{satisfaction.average === null ? "—" : `${satisfaction.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ★`}</strong><p>{satisfaction.total ? `${satisfaction.total} avaliações` : "sem avaliações"}</p></article>
      <article className={numbers.lateProjects.length ? "warn" : ""}><small>Projetos ativos</small><strong>{numbers.activeProjects}</strong><p>{numbers.lateProjects.length ? `${numbers.lateProjects.length} com previsão vencida` : "dentro da previsão"}</p></article>
    </div>

    <div className="report-columns equal">
      <section className="report-card">
        <div className="report-card-head"><div><h3>Por cliente</h3><p>Demandas e chamados abertos e concluídos no mês.</p></div></div>
        {numbers.byClient.length ? <div className="report-table-wrap"><table className="report-table">
          <thead><tr><th>Cliente</th><th>Demandas</th><th>Entregues</th><th>Chamados</th><th>Resolvidos</th></tr></thead>
          <tbody>{numbers.byClient.map((row) => <tr key={row.client}><td>{row.client}</td><td>{row.tasksOpened}</td><td>{row.tasksDelivered}</td><td>{row.ticketsOpened}</td><td>{row.ticketsResolved}</td></tr>)}</tbody>
        </table></div> : <p className="muted">Nada no mês.</p>}
      </section>
      <section className="report-card">
        <div className="report-card-head"><div><h3>Atrasadas</h3><p>Demandas abertas com prazo vencido.</p></div></div>
        {numbers.overdue.length ? <ul className="monthly-list">{numbers.overdue.slice(0, 12).map((task) => <li key={task.id}><b>{taskCode(task.id)}</b><span>{task.title}</span><em>{fullDate(task.dueDate)}</em></li>)}{numbers.overdue.length > 12 && <li className="more">e mais {numbers.overdue.length - 12} (todas no Excel)</li>}</ul> : <p className="muted">Nenhuma demanda atrasada.</p>}
        {numbers.lateProjects.length > 0 && <>
          <h4 className="monthly-subtitle">Projetos com previsão vencida</h4>
          <ul className="monthly-list">{numbers.lateProjects.map((project) => <li key={project.id}><span>{project.name}</span><em>{fullDate(project.endForecast)}</em></li>)}</ul>
        </>}
      </section>
    </div>
  </div>;
}

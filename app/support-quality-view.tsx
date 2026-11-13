"use client";

import { useEffect, useMemo, useState } from "react";
import Download from "lucide-react/icons/download";
import { MonthPicker } from "./leadership-reports";
import { formatDuration, monthlyTrend, qualityReport, type QualityTicket } from "./support-quality";
import { firstResponseHours, resolutionHours, ticketCode, ticketUrgencyLabels, type TicketUrgency } from "./tickets";
import { satisfactionSummary, stars, type RatedTicket } from "./ticket-rating";
import { monthLabel, monthRange } from "./time-entries";
import { downloadXlsx } from "./xlsx-writer";

const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const pct = (value: number | null) => (value === null ? "—" : percent.format(value));
const deadlines = { response: firstResponseHours, resolution: resolutionHours };

/** Painel de qualidade do Suporte: prazos cumpridos e tempos, por cliente, pessoa, urgência e mês. */
export default function SupportQualityView({ teamId, teamLabel, today }: { teamId: number | null; teamLabel: string; today: string }) {
  const [month, setMonth] = useState<string | null>(today.slice(0, 7));
  const [tickets, setTickets] = useState<(QualityTicket & RatedTicket)[] | null>(null);
  const [people, setPeople] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/tickets", { cache: "no-store" });
        const data = await response.json() as { tickets?: (QualityTicket & RatedTicket)[]; members?: { id: number; name: string }[]; error?: string };
        if (!response.ok || !data.tickets) throw new Error(data.error || "Não foi possível carregar os chamados.");
        if (cancelled) return;
        setTickets(data.tickets);
        setPeople(new Map((data.members ?? []).map((person) => [person.id, person.name])));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível carregar os chamados.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const scoped = useMemo(() => (tickets ?? []).filter((ticket) => teamId === null || ticket.teamId === teamId), [tickets, teamId]);
  const range = useMemo(() => (month ? monthRange(month) : { from: "2000-01-01", to: today }), [month, today]);
  const report = useMemo(() => qualityReport(scoped, { ...range, now, deadlines }), [scoped, range, now]);
  const trend = useMemo(() => monthlyTrend(scoped, (month ?? today).slice(0, 7), 6, now, deadlines), [scoped, month, today, now]);
  const satisfaction = useMemo(() => satisfactionSummary(scoped, range.from, range.to), [scoped, range]);
  const maxTrend = Math.max(...trend.map((row) => Math.max(row.opened, row.resolved)), 1);
  const period = month ? monthLabel(month) : "todo o período";
  const personName = (id: number | null) => (id === null ? "Sem responsável" : people.get(id) ?? "Pessoa removida");

  function exportExcel() {
    const ratesColumns = [
      { header: "Abertos", type: "number" as const, width: 9 }, { header: "Resolvidos", type: "number" as const, width: 11 },
      { header: "1ª resposta no prazo", type: "percent" as const, width: 20 }, { header: "Solução no prazo", type: "percent" as const, width: 16 },
      { header: "Tempo médio 1ª resposta (h)", type: "number" as const, width: 25 }, { header: "Tempo médio solução (h)", type: "number" as const, width: 22 },
    ];
    const hours = (minutes: number | null) => (minutes === null ? null : Math.round((minutes / 60) * 10) / 10);
    type Row<K> = { key: K; opened: number; resolved: number; responseRate: number | null; resolutionRate: number | null; avgResponseMinutes: number | null; avgResolutionMinutes: number | null };
    const rowsOf = <K,>(rows: Row<K>[], name: (key: K) => string) => rows.map((row) => [name(row.key), row.opened, row.resolved, row.responseRate, row.resolutionRate, hours(row.avgResponseMinutes), hours(row.avgResolutionMinutes)]);
    downloadXlsx(`qualidade-suporte-${month ?? "tudo"}.xlsx`, [
      { name: "Resumo", columns: [{ header: "Indicador", width: 32 }, { header: "Valor", width: 18 }], rows: [
        ["Período", period], ["Time", teamLabel], ["Chamados abertos", report.opened], ["Chamados resolvidos", report.resolved],
        ["1ª resposta no prazo", pct(report.responseRate)], ["Solução no prazo", pct(report.resolutionRate)],
        ["Tempo médio de 1ª resposta", formatDuration(report.avgResponseMinutes)], ["Tempo mediano de 1ª resposta", formatDuration(report.medianResponseMinutes)],
        ["Tempo médio de solução", formatDuration(report.avgResolutionMinutes)], ["Tempo mediano de solução", formatDuration(report.medianResolutionMinutes)],
        ["Em aberto agora", report.backlog], ["Fora do prazo agora", report.lateNow],
      ] },
      { name: "Por cliente", columns: [{ header: "Cliente", width: 24 }, ...ratesColumns], rows: rowsOf(report.byClient, (key: string) => key) },
      { name: "Por responsável", columns: [{ header: "Responsável", width: 24 }, ...ratesColumns], rows: rowsOf(report.byPerson, (key: number | null) => personName(key)) },
      { name: "Por urgência", columns: [{ header: "Urgência", width: 14 }, ...ratesColumns], rows: rowsOf(report.byUrgency, (key: string) => ticketUrgencyLabels[key as TicketUrgency] ?? key) },
      { name: "Satisfação", columns: [{ header: "Responsável", width: 24 }, { header: "Avaliações", type: "number", width: 12 }, { header: "Nota média", type: "number", width: 12 }], rows: [
        ...satisfaction.byPerson.map((row) => [personName(row.assigneeId), row.count, Math.round(row.average * 10) / 10]),
        [], ["Total", satisfaction.total, satisfaction.average === null ? null : Math.round(satisfaction.average * 10) / 10], ["Satisfeitos (4 e 5 estrelas)", pct(satisfaction.satisfied)],
      ] },
      { name: "Mês a mês", columns: [{ header: "Mês", width: 20 }, { header: "Abertos", type: "number", width: 9 }, { header: "Resolvidos", type: "number", width: 11 }, { header: "1ª resposta no prazo", type: "percent", width: 20 }, { header: "Solução no prazo", type: "percent", width: 16 }], rows: trend.map((row) => [monthLabel(row.month), row.opened, row.resolved, row.responseRate, row.resolutionRate]) },
    ]);
  }

  if (error) return <div className="alert error"><span>{error}</span></div>;
  if (!tickets) return <div className="loading-list"><span /><span /></div>;

  const table = <K,>(title: string, rows: { key: K; opened: number; resolved: number; responseRate: number | null; resolutionRate: number | null; avgResolutionMinutes: number | null }[], name: (key: K) => string) => <section className="report-card">
    <div className="report-card-head"><div><h3>{title}</h3><p>Abertos e prazos de quem abriu no período; resolvidos e tempo de quem foi resolvido no período.</p></div></div>
    {rows.length ? <div className="report-table-wrap"><table className="report-table">
      <thead><tr><th>{title.replace("Por ", "")}</th><th>Abertos</th><th>Resolvidos</th><th>1ª resposta no prazo</th><th>Solução no prazo</th><th>Tempo médio de solução</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={String(row.key)}><td>{name(row.key)}</td><td>{row.opened}</td><td>{row.resolved}</td><td className={row.responseRate !== null && row.responseRate < 0.8 ? "late" : ""}>{pct(row.responseRate)}</td><td className={row.resolutionRate !== null && row.resolutionRate < 0.8 ? "late" : ""}>{pct(row.resolutionRate)}</td><td>{formatDuration(row.avgResolutionMinutes)}</td></tr>)}</tbody>
    </table></div> : <p className="muted">Nada no período.</p>}
  </section>;

  return <div className="quality-page">
    <div className="report-card-toolbar quality-toolbar">
      <div><h3>Qualidade do Suporte · {period}</h3><p>Prazos: 1ª resposta (Crítica 2 h, Alta 8 h, Normal 24 h, Baixa 72 h) e solução (8 h, 2 d, 5 d, 10 d), em horas corridas.</p></div>
      <div className="report-actions"><MonthPicker month={month} today={today} onChange={setMonth} allowAll /><button className="secondary-button" onClick={exportExcel}><Download size={15} /> Exportar Excel</button></div>
    </div>

    <div className="leadership-tiles">
      <article><small>Abertos</small><strong>{report.opened}</strong><p>no período</p></article>
      <article><small>Resolvidos</small><strong>{report.resolved}</strong><p>no período</p></article>
      <article className={report.responseRate !== null && report.responseRate < 0.8 ? "warn" : ""}><small>1ª resposta no prazo</small><strong>{pct(report.responseRate)}</strong><p>mediana {formatDuration(report.medianResponseMinutes)}</p></article>
      <article className={report.resolutionRate !== null && report.resolutionRate < 0.8 ? "warn" : ""}><small>Solução no prazo</small><strong>{pct(report.resolutionRate)}</strong><p>mediana {formatDuration(report.medianResolutionMinutes)}</p></article>
      <article><small>Em aberto agora</small><strong>{report.backlog}</strong><p>{teamLabel}</p></article>
      <article className={report.lateNow ? "late" : ""}><small>Fora do prazo agora</small><strong>{report.lateNow}</strong><p>sem resposta ou solução no prazo</p></article>
      <article className={satisfaction.satisfied !== null && satisfaction.satisfied < 0.7 ? "warn" : ""}><small>Satisfação</small><strong>{satisfaction.average === null ? "—" : `${satisfaction.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ★`}</strong><p>{satisfaction.total ? `${pct(satisfaction.satisfied)} satisfeitos · ${satisfaction.total} ${satisfaction.total === 1 ? "avaliação" : "avaliações"}` : "sem avaliações"}</p></article>
    </div>

    {satisfaction.total > 0 && <section className="report-card satisfaction-card">
      <div className="report-card-head"><div><h3>Avaliação do atendimento</h3><p>Notas de quem abriu os chamados resolvidos no período (chamados do Jira não entram).</p></div></div>
      <div className="satisfaction-grid">
        <div className="satisfaction-bars">{[5, 4, 3, 2, 1].map((value) => <div key={value}><span>{value} ★</span><i><b style={{ width: `${(satisfaction.distribution[value - 1] / satisfaction.total) * 100}%` }} /></i><em>{satisfaction.distribution[value - 1]}</em></div>)}</div>
        <ul className="satisfaction-people">{satisfaction.byPerson.map((row) => <li key={String(row.assigneeId)}><span>{personName(row.assigneeId)}</span><b>{row.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ★</b><small>{row.count}</small></li>)}</ul>
      </div>
      {satisfaction.comments.length > 0 && <ul className="satisfaction-comments">{satisfaction.comments.map((entry) => <li key={entry.id}><span>{stars(entry.rating)}</span><p>“{entry.comment}”</p><small>{ticketCode(entry.id)} · {entry.title}</small></li>)}</ul>}
    </section>}

    <section className="report-card">
      <div className="report-card-head"><div><h3>Mês a mês</h3><p>Chamados abertos e resolvidos nos últimos 6 meses, e o percentual de solução no prazo.</p></div>
        <div className="chart-legend"><span><i className="opened" />Abertos</span><span><i className="resolved" />Resolvidos</span></div></div>
      <div className="quality-trend">{trend.map((row) => <div key={row.month} className="quality-month">
        <div className="quality-bars"><span className="opened" style={{ height: `${(row.opened / maxTrend) * 100}%` }} title={`${row.opened} abertos`}><b>{row.opened || ""}</b></span><span className="resolved" style={{ height: `${(row.resolved / maxTrend) * 100}%` }} title={`${row.resolved} resolvidos`}><b>{row.resolved || ""}</b></span></div>
        <small>{monthLabel(row.month).replace(" de ", "/").slice(0, 3)}/{row.month.slice(2, 4)}</small>
        <em className={row.resolutionRate !== null && row.resolutionRate < 0.8 ? "late" : ""}>{pct(row.resolutionRate)}</em>
      </div>)}</div>
    </section>

    <div className="report-columns equal">
      {table("Por cliente", report.byClient, (key: string) => key)}
      {table("Por responsável", report.byPerson, (key: number | null) => personName(key))}
    </div>
    {table("Por urgência", report.byUrgency, (key: string) => ticketUrgencyLabels[key as TicketUrgency] ?? key)}
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import BarChart3 from "lucide-react/icons/bar-chart-3";
import { reportPeriods, type InventoryReport, type ReportMovementType } from "./reports";

const series: { type: ReportMovementType; label: string; plural: string }[] = [
  { type: "purchase", label: "Compra", plural: "Compras" },
  { type: "open", label: "Abertura", plural: "Aberturas" },
  { type: "consume", label: "Consumo", plural: "Consumos" },
  { type: "adjust", label: "Ajuste", plural: "Ajustes" },
];

const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const fmt = (value: number) => numberFormat.format(value);

function monthLabel(month: string, style: "short" | "long" = "short") {
  const label = new Intl.DateTimeFormat("pt-BR", { month: style, timeZone: "UTC", ...(style === "long" ? { year: "numeric" } : {}) }).format(new Date(`${month}-15T12:00:00Z`));
  const clean = label.replace(".", "");
  return style === "long" ? clean.charAt(0).toLocaleUpperCase("pt-BR") + clean.slice(1) : clean;
}

/** Topo do eixo arredondado para 1, 2 ou 5 × 10ⁿ, com 4 divisões. */
function axisTicks(max: number) {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? rough;
  const niceStep = Math.max(1, Math.ceil(step));
  return [0, 1, 2, 3, 4].map((index) => index * niceStep);
}

function mediaUrl(key: string | null) {
  return key ? `/api/media?key=${encodeURIComponent(key)}` : "";
}

function Legend() {
  return <ul className="report-legend" aria-label="Legenda">{series.map((entry) => <li key={entry.type}><i className={`swatch ${entry.type}`} />{entry.plural}</li>)}</ul>;
}

function MonthlyChart({ report }: { report: InventoryReport }) {
  const [active, setActive] = useState<number | null>(null);
  const totals = report.monthly.map((month) => month.purchase + month.open + month.consume + month.adjust);
  const ticks = axisTicks(Math.max(...totals, 0));
  const top = ticks.at(-1)!;
  const peak = totals.indexOf(Math.max(...totals));

  return <div className="monthly-chart" onMouseLeave={() => setActive(null)}>
    <div className="monthly-plot">
      <div className="monthly-grid" aria-hidden="true">{[...ticks].reverse().map((tick) => <div key={tick}><span>{fmt(tick)}</span></div>)}</div>
      <div className="monthly-columns">
        {report.monthly.map((month, index) => {
          const total = totals[index];
          return <div key={month.month} className={`monthly-slot ${active === index ? "active" : ""}`} tabIndex={0} role="img" aria-label={`${monthLabel(month.month, "long")}: ${series.map((entry) => `${month[entry.type]} ${entry.plural.toLocaleLowerCase("pt-BR")}`).join(", ")}`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
            <div className="monthly-stack" style={{ height: `${(total / top) * 100}%` }}>
              {(index === peak || index === totals.length - 1) && total > 0 && <b className="monthly-cap">{fmt(total)}</b>}
              {series.map((entry) => month[entry.type] > 0 && <span key={entry.type} className={`segment ${entry.type}`} style={{ flexGrow: month[entry.type] }} />)}
            </div>
            {active === index && <div className={`chart-tooltip ${index > report.monthly.length / 2 ? "left" : ""}`}>
              <strong>{monthLabel(month.month, "long")}</strong>
              {series.map((entry) => <div key={entry.type}><i className={`swatch ${entry.type}`} /><span>{entry.plural}</span><b>{month[entry.type]}</b></div>)}
              <div className="tooltip-total"><span>Total</span><b>{total}</b></div>
            </div>}
          </div>;
        })}
      </div>
    </div>
    <div className="monthly-labels" aria-hidden="true">{report.monthly.map((month) => <span key={month.month}>{monthLabel(month.month)}</span>)}</div>
  </div>;
}

function MonthlyTable({ report }: { report: InventoryReport }) {
  return <div className="report-table-wrap"><table className="report-table">
    <thead><tr><th>Mês</th>{series.map((entry) => <th key={entry.type}>{entry.plural}</th>)}<th>Total</th></tr></thead>
    <tbody>{report.monthly.map((month) => <tr key={month.month}><td>{monthLabel(month.month, "long")}</td>{series.map((entry) => <td key={entry.type}>{month[entry.type]}</td>)}<td><b>{month.purchase + month.open + month.consume + month.adjust}</b></td></tr>)}</tbody>
  </table></div>;
}

function ConsumptionBars({ values, months, unit }: { values: number[]; months: string[]; unit: string }) {
  const max = Math.max(...values, 0);
  return <div className="consumption-bars" role="img" aria-label={`Consumo por mês: ${values.map((value, index) => `${monthLabel(months[index])} ${fmt(value)} ${unit}`).join(", ")}`}>
    {values.map((value, index) => <span key={months[index]} title={`${monthLabel(months[index], "long")}: ${fmt(value)} ${unit}`}><i style={{ height: max ? `${Math.max(value > 0 ? 8 : 0, (value / max) * 100)}%` : 0 }} /></span>)}
  </div>;
}

function PeopleChart({ report }: { report: InventoryReport }) {
  const [active, setActive] = useState<string | null>(null);
  const people = report.people.slice(0, 8);
  const max = Math.max(...people.map((person) => person.total), 1);
  return <div className="people-chart">
    {people.map((person, index) => <div key={person.name} className="people-row" tabIndex={0} onMouseEnter={() => setActive(person.name)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(person.name)} onBlur={() => setActive(null)} aria-label={`${person.name}: ${person.total} registros (${series.map((entry) => `${person[entry.type]} ${entry.plural.toLocaleLowerCase("pt-BR")}`).join(", ")})`}>
      <span className="people-name"><small>{index + 1}º</small>{person.name}</span>
      <div className="people-track">
        <div className="people-bar" style={{ width: `${(person.total / max) * 100}%` }}>{series.map((entry) => person[entry.type] > 0 && <span key={entry.type} className={`segment ${entry.type}`} style={{ flexGrow: person[entry.type] }} />)}</div>
        <b>{person.total}</b>
      </div>
      {active === person.name && <div className="chart-tooltip people-tooltip">
        <strong>{person.name}</strong>
        {series.map((entry) => <div key={entry.type}><i className={`swatch ${entry.type}`} /><span>{entry.plural}</span><b>{person[entry.type]}</b></div>)}
      </div>}
    </div>)}
    {report.people.length > people.length && <p className="report-footnote">Mostrando as 8 pessoas com mais registros de {report.people.length}.</p>}
  </div>;
}

export default function ReportsView() {
  const [months, setMonths] = useState<number>(6);
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/reports?months=${months}`, { cache: "no-store" });
        const data = await response.json() as InventoryReport & { error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível gerar os relatórios.");
        if (!cancelled) setReport(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível gerar os relatórios.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [months]);

  const periodLabel = report ? `${monthLabel(report.months[0], "long")} a ${monthLabel(report.months.at(-1)!, "long")}`.toLocaleLowerCase("pt-BR") : "";
  const busiest = report?.people[0];

  return <>
    <div className="report-filters">
      <div><h2>Relatórios do estoque</h2><p>{periodLabel ? `De ${periodLabel}. ` : ""}Contagem de registros feitos no sistema.</p></div>
      <div className="report-period" role="group" aria-label="Período">{reportPeriods.map((period) => <button key={period} className={months === period ? "active" : ""} aria-pressed={months === period} onClick={() => setMonths(period)}>{period} meses</button>)}</div>
    </div>

    {error ? <div className="alert error"><span>{error}</span></div> : loading && !report ? <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div> : report && report.totals.all === 0 ? (
      <div className="empty-state"><span><BarChart3 /></span><h3>Nenhuma movimentação no período</h3><p>Os relatórios aparecem conforme a equipe registra compras, aberturas e consumos.</p></div>
    ) : report && <div className={`report-body ${loading ? "refreshing" : ""}`}>
      <div className="report-tiles">
        <article><small>Registros no período</small><strong>{fmt(report.totals.all)}</strong><p>{fmt(report.totals.all / report.months.length)} por mês, em média</p></article>
        <article><small>Compras</small><strong>{fmt(report.totals.purchase)}</strong><p>{report.totals.adjust ? `${report.totals.adjust} ajustes de saldo` : "Nenhum ajuste de saldo"}</p></article>
        <article><small>Aberturas e consumos</small><strong>{fmt(report.totals.open + report.totals.consume)}</strong><p>{report.totals.open} aberturas · {report.totals.consume} consumos</p></article>
        <article><small>Quem mais registrou</small><strong className="report-tile-name">{busiest?.name ?? "—"}</strong><p>{busiest ? `${busiest.total} ${busiest.total === 1 ? "registro" : "registros"}` : ""}</p></article>
      </div>

      <section className="report-card">
        <div className="report-card-head"><div><h3>Registros por mês</h3><p>Passe o mouse sobre um mês para ver os números.</p></div><button className="report-toggle" onClick={() => setShowTable((value) => !value)}>{showTable ? "Ver gráfico" : "Ver tabela"}</button></div>
        <Legend />
        {showTable ? <MonthlyTable report={report} /> : <MonthlyChart report={report} />}
      </section>

      <div className="report-columns">
        <section className="report-card">
          <div className="report-card-head"><div><h3>Movimentação por item</h3><p>Quantidades na unidade de cada item. As barras mostram o consumo mês a mês.</p></div></div>
          <div className="report-table-wrap"><table className="report-table item-report">
            <thead><tr><th>Item</th><th>Consumido</th><th>Comprado</th><th>Aberto</th><th>Consumo por mês</th></tr></thead>
            <tbody>{report.items.map((item) => <tr key={item.id}>
              <td><span className="report-item"><span className="report-item-visual">{item.imageKey ? <Image src={mediaUrl(item.imageKey)} alt="" fill sizes="28px" unoptimized /> : item.icon}</span><span><strong>{item.name}</strong><small>{item.unit}</small></span></span></td>
              <td>{fmt(item.consumed)}</td><td>{fmt(item.purchased)}</td><td>{fmt(item.opened)}</td>
              <td><ConsumptionBars values={item.monthlyConsumed} months={report.months} unit={item.unit} /></td>
            </tr>)}</tbody>
          </table></div>
        </section>

        <section className="report-card">
          <div className="report-card-head"><div><h3>Quem mais registra</h3><p>Total de registros por pessoa no período.</p></div></div>
          <Legend />
          <PeopleChart report={report} />
        </section>
      </div>
    </div>}
  </>;
}

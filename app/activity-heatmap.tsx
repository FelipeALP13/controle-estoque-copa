"use client";

// Mapa de calor do último ano (estilo GitHub): um quadradinho por dia, mais escuro quanto mais atividade
// (demandas concluídas, chamados resolvidos e horas lançadas).
import { useEffect, useMemo, useState } from "react";
import { activityLevel, activityScore, activityText, activityTotals, activityWeeks, type ActivityDay } from "./activity";

type Data = { from: string; to: string; days: Record<string, ActivityDay> };

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

function dayTitle(date: string, day: ActivityDay | undefined) {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, dayOfMonth, 12)).getUTCDay()];
  return `${weekday}, ${String(dayOfMonth).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}: ${activityText(day)}`;
}

export function ActivityHeatmap({ memberId, title = "Atividade no último ano" }: { memberId?: number; title?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/activity${memberId ? `?memberId=${memberId}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json() as Data & { error?: string };
        if (!response.ok) throw new Error(json.error || "Não foi possível carregar a atividade.");
        if (!cancelled) setData(json);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível carregar a atividade."); });
    return () => { cancelled = true; };
  }, [memberId]);

  const view = useMemo(() => {
    if (!data) return null;
    const weeks = activityWeeks(data.from, data.to);
    const max = Math.max(0, ...Object.values(data.days).map(activityScore));
    // Rótulo do mês na primeira semana em que ele aparece (sem colar dois rótulos).
    let lastMonth = -1;
    let lastLabelAt = -4;
    const labels = weeks.map((week, index) => {
      const first = week.find((date) => date && Number(date.slice(8, 10)) <= 7);
      const month = first ? Number(first.slice(5, 7)) - 1 : -1;
      if (month < 0 || month === lastMonth || index - lastLabelAt < 3) return "";
      lastMonth = month;
      lastLabelAt = index;
      return MONTHS[month];
    });
    return { weeks, max, labels, totals: activityTotals(data.days) };
  }, [data]);

  if (error) return <div className="activity-card"><p className="muted">{error}</p></div>;
  if (!data || !view) return <div className="activity-card"><div className="loading-list"><span /></div></div>;
  const { weeks, max, labels, totals } = view;
  const hours = Number.isInteger(totals.hours) ? String(totals.hours) : totals.hours.toFixed(1).replace(".", ",");

  return <div className="activity-card">
    <div className="activity-head">
      <strong>{title}</strong>
      <small>{totals.activeDays ? `${totals.tasks} ${totals.tasks === 1 ? "demanda" : "demandas"} · ${totals.tickets} ${totals.tickets === 1 ? "chamado" : "chamados"} · ${hours} h em ${totals.activeDays} ${totals.activeDays === 1 ? "dia" : "dias"}` : "Nenhuma atividade registrada ainda."}</small>
    </div>
    <div className="activity-scroll">
      <div className="activity-grid" role="img" aria-label={`${title}: ${totals.tasks} demandas concluídas, ${totals.tickets} chamados resolvidos e ${hours} horas lançadas`} style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--activity-cell))` }}>
        {labels.map((label, index) => <span key={`m${index}`} className="activity-month" style={{ gridColumn: index + 1 }}>{label}</span>)}
        {weeks.map((week, column) => week.map((date, row) => date
          ? <i key={date} className={`activity-cell l${activityLevel(activityScore(data.days[date]), max)}`} style={{ gridColumn: column + 1, gridRow: row + 2 }} title={dayTitle(date, data.days[date])} />
          : null))}
      </div>
    </div>
    <div className="activity-legend" aria-hidden="true"><span>Menos</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`activity-cell l${level}`} />)}<span>Mais</span></div>
  </div>;
}

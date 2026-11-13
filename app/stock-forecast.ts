// Previsão de consumo e lista de compras automática da copa (regras puras, usadas pela tela e pelos testes).

export type ForecastInput = {
  id: number;
  name: string;
  unit: string;
  category: string;
  unopenedQty: number;
  openedQty: number;
  minimumQty: number;
  /** Dias que uma unidade dura, em média (null = ainda medindo). */
  averageDurationDays: number | null;
};

export type Urgency = "now" | "soon" | "later" | "ok";

export type Forecast = {
  available: number;
  /** Dias até acabar o saldo (null = sem medição). */
  daysLeft: number | null;
  /** Dia (AAAA-MM-DD) em que o saldo acaba, pelo ritmo médio. */
  endsOn: string | null;
  urgency: Urgency;
};

export const COVER_OPTIONS = [15, 30, 45, 60] as const;
export const DEFAULT_COVER_DAYS = 30;
/** Abaixo disso, comprar já. */
const NOW_DAYS = 3;
/** Até aqui, entra na lista de compras. */
const SOON_DAYS = 7;
/** Até aqui, aparece como "em breve" (ainda não precisa comprar). */
const LATER_DAYS = 14;

const DAY = 86400000;
const addDays = (today: string, days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + Math.floor(days) * DAY).toISOString().slice(0, 10);

export function forecastItem(item: ForecastInput, today: string): Forecast {
  const available = Math.max(0, item.unopenedQty + item.openedQty);
  const measured = item.averageDurationDays !== null && item.averageDurationDays > 0;
  const daysLeft = measured ? Math.round(available * item.averageDurationDays! * 10) / 10 : null;
  const belowMinimum = available <= item.minimumQty;
  let urgency: Urgency = "ok";
  if (available <= 0 || (daysLeft !== null && daysLeft <= NOW_DAYS)) urgency = "now";
  else if (belowMinimum || (daysLeft !== null && daysLeft <= SOON_DAYS)) urgency = "soon";
  else if (daysLeft !== null && daysLeft <= LATER_DAYS) urgency = "later";
  return { available, daysLeft, endsOn: daysLeft === null ? null : addDays(today, daysLeft), urgency };
}

/**
 * Quanto comprar para ficar coberto por `coverDays` dias e ainda sobrar o estoque mínimo.
 * Sem medição de consumo, completa só até o mínimo (como antes).
 */
export function suggestedPurchase(item: ForecastInput, coverDays = DEFAULT_COVER_DAYS) {
  const available = Math.max(0, item.unopenedQty + item.openedQty);
  const measured = item.averageDurationDays !== null && item.averageDurationDays > 0;
  const target = item.minimumQty + (measured ? coverDays / item.averageDurationDays! : 0);
  const missing = target - available;
  if (missing <= 0) return available <= item.minimumQty ? 1 : 0;
  return Math.max(1, Math.ceil(missing - 1e-9));
}

export type ShoppingLine = ForecastInput & Forecast & { buy: number; reason: string };

const rank: Record<Urgency, number> = { now: 0, soon: 1, later: 2, ok: 3 };
/** Dentro da mesma urgência: o que já acabou primeiro, depois o que acaba antes. */
const order = (line: Forecast) => (line.available <= 0 ? -1 : line.daysLeft ?? Infinity);

function reasonFor(item: ForecastInput, forecast: Forecast) {
  if (forecast.available <= 0) return "Acabou";
  if (forecast.daysLeft !== null && forecast.daysLeft <= SOON_DAYS) return forecast.daysLeft < 1 ? "Acaba hoje" : `Acaba em ~${Math.max(1, Math.round(forecast.daysLeft))} ${Math.round(forecast.daysLeft) <= 1 ? "dia" : "dias"}`;
  if (forecast.available <= item.minimumQty) return "No mínimo ou abaixo";
  return "";
}

/** Lista de compras: o que acabou, está no mínimo ou acaba em até 7 dias, do mais urgente ao menos. */
export function shoppingList(items: readonly ForecastInput[], today: string, coverDays = DEFAULT_COVER_DAYS): ShoppingLine[] {
  return items
    .map((item) => {
      const forecast = forecastItem(item, today);
      return { ...item, ...forecast, buy: suggestedPurchase(item, coverDays), reason: reasonFor(item, forecast) };
    })
    .filter((line) => line.urgency === "now" || line.urgency === "soon")
    .map((line) => ({ ...line, buy: Math.max(1, line.buy) }))
    .sort((a, b) => rank[a.urgency] - rank[b.urgency] || order(a) - order(b) || a.name.localeCompare(b.name, "pt-BR"));
}

/** Itens que acabam em 8 a 14 dias: ainda não é hora de comprar, mas vale ficar de olho. */
export function comingUp(items: readonly ForecastInput[], today: string) {
  return items
    .map((item) => ({ ...item, ...forecastItem(item, today) }))
    .filter((line) => line.urgency === "later")
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
}

const fmt = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

/** Texto para mandar no WhatsApp. */
export function shoppingMessage(lines: readonly ShoppingLine[], appName: string, coverDays: number, todayLabel: string) {
  return [
    `🛒 *Lista de compras — ${appName}*`,
    `Para cerca de ${coverDays} dias de consumo.`,
    "",
    ...lines.map((line) => `• *${line.name}*: comprar ${fmt(line.buy)} ${line.unit} (tem ${fmt(line.available)}${line.reason ? ` · ${line.reason.toLowerCase()}` : ""})`),
    "",
    `Gerada em ${todayLabel}.`,
  ].join("\n");
}

/** "acaba hoje", "acaba em ~5 dias", "dura ~2 meses". */
export function daysLeftLabel(daysLeft: number | null) {
  if (daysLeft === null) return "";
  if (daysLeft < 1) return "acaba hoje";
  const days = Math.round(daysLeft);
  if (days < 60) return `acaba em ~${days} ${days === 1 ? "dia" : "dias"}`;
  return `dura ~${Math.round(days / 30)} meses`;
}

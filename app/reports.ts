export type ReportMovementType = "purchase" | "open" | "consume" | "adjust";

export type ReportMovement = {
  itemId: number;
  type: ReportMovementType;
  quantity: number;
  createdAt: string;
  createdByName: string | null;
};

export type ReportItem = { id: number; name: string; unit: string; icon: string; imageKey: string | null };

type TypeCounts = Record<ReportMovementType, number>;

export type InventoryReport = {
  months: string[];
  totals: TypeCounts & { all: number };
  monthly: (TypeCounts & { month: string })[];
  items: (ReportItem & { consumed: number; purchased: number; opened: number; events: number; monthlyConsumed: number[] })[];
  people: (TypeCounts & { name: string; total: number })[];
};

export const reportPeriods = [3, 6, 12] as const;

const emptyCounts = (): TypeCounts => ({ purchase: 0, open: 0, consume: 0, adjust: 0 });

/** O banco guarda datas como ISO ou no formato do SQLite (UTC, sem fuso). */
export function parseStoredDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function monthKeyInSaoPaulo(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}`;
}

/** Os últimos `count` meses, do mais antigo ao atual. */
export function lastMonthKeys(now: Date, count: number) {
  const [year, month] = monthKeyInSaoPaulo(now).split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

export function normalizePeriod(value: unknown) {
  const months = Number(value);
  return (reportPeriods as readonly number[]).includes(months) ? months : 6;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function buildReport(movements: readonly ReportMovement[], items: readonly ReportItem[], months: readonly string[]): InventoryReport {
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const monthly = months.map((month) => ({ month, ...emptyCounts() }));
  const totals = { ...emptyCounts(), all: 0 };
  const itemStats = new Map<number, InventoryReport["items"][number]>();
  const people = new Map<string, InventoryReport["people"][number]>();

  for (const movement of movements) {
    const date = parseStoredDate(movement.createdAt);
    if (!date) continue;
    const index = monthIndex.get(monthKeyInSaoPaulo(date));
    if (index === undefined) continue;

    monthly[index][movement.type] += 1;
    totals[movement.type] += 1;
    totals.all += 1;

    const item = items.find((entry) => entry.id === movement.itemId);
    if (item) {
      const stats = itemStats.get(item.id) ?? { ...item, consumed: 0, purchased: 0, opened: 0, events: 0, monthlyConsumed: months.map(() => 0) };
      const quantity = Math.abs(movement.quantity);
      if (movement.type === "consume") { stats.consumed += quantity; stats.monthlyConsumed[index] += quantity; }
      if (movement.type === "purchase") stats.purchased += quantity;
      if (movement.type === "open") stats.opened += quantity;
      stats.events += 1;
      itemStats.set(item.id, stats);
    }

    const name = movement.createdByName?.trim() || "Equipe";
    const person = people.get(name) ?? { name, total: 0, ...emptyCounts() };
    person[movement.type] += 1;
    person.total += 1;
    people.set(name, person);
  }

  return {
    months: [...months],
    totals,
    monthly,
    items: [...itemStats.values()]
      .map((item) => ({ ...item, consumed: round(item.consumed), purchased: round(item.purchased), opened: round(item.opened), monthlyConsumed: item.monthlyConsumed.map(round) }))
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name, "pt-BR")),
    people: [...people.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR")),
  };
}

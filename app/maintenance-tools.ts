// Regras puras (sem banco) dos pedidos de manutenção do escritório. Não importa outros arquivos do app.

export const MAINTENANCE_CATEGORIES = [
  { key: "air", label: "Ar-condicionado", emoji: "❄️" },
  { key: "electric", label: "Elétrica e iluminação", emoji: "💡" },
  { key: "plumbing", label: "Hidráulica e banheiro", emoji: "🚿" },
  { key: "network", label: "Internet e rede", emoji: "📶" },
  { key: "furniture", label: "Móveis e cadeiras", emoji: "🪑" },
  { key: "kitchen", label: "Copa e cozinha", emoji: "☕" },
  { key: "cleaning", label: "Limpeza", emoji: "🧹" },
  { key: "security", label: "Portas, chaves e segurança", emoji: "🔑" },
  { key: "other", label: "Outro", emoji: "🛠️" },
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number]["key"];
export const isMaintenanceCategory = (value: unknown): value is MaintenanceCategory => MAINTENANCE_CATEGORIES.some((entry) => entry.key === value);
export const maintenanceCategory = (key: string) => MAINTENANCE_CATEGORIES.find((entry) => entry.key === key) ?? MAINTENANCE_CATEGORIES[MAINTENANCE_CATEGORIES.length - 1];

export const MAINTENANCE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];
export const maintenancePriorityLabels: Record<MaintenancePriority, string> = { low: "Pode esperar", normal: "Normal", high: "Alta", urgent: "Urgente" };
export const isMaintenancePriority = (value: unknown): value is MaintenancePriority => (MAINTENANCE_PRIORITIES as readonly unknown[]).includes(value);

export const MAINTENANCE_STATUSES = ["open", "in_progress", "waiting", "done", "canceled"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export const maintenanceStatusLabels: Record<MaintenanceStatus, string> = { open: "Aberto", in_progress: "Em andamento", waiting: "Aguardando (peça/terceiro)", done: "Resolvido", canceled: "Cancelado" };
export const isMaintenanceStatus = (value: unknown): value is MaintenanceStatus => (MAINTENANCE_STATUSES as readonly unknown[]).includes(value);
export const isActiveMaintenance = (status: string) => status === "open" || status === "in_progress" || status === "waiting";

export const MAX_MAINTENANCE_TITLE = 120;
export const MAX_MAINTENANCE_TEXT = 1500;
export const MAX_MAINTENANCE_LOCATION = 80;

/** Quem mexe no pedido: quem cuida da manutenção mexe em tudo; quem abriu só cancela e comenta. */
export function canChangeStatus(input: { handler: boolean; isCreator: boolean; from: string; to: MaintenanceStatus }) {
  if (input.handler) return true;
  if (!input.isCreator) return false;
  // Quem abriu pode cancelar enquanto está ativo e reabrir se o problema voltou.
  return (input.to === "canceled" && isActiveMaintenance(input.from)) || (input.to === "open" && input.from === "done");
}

/** Ordem da lista: urgentes primeiro, depois os mais antigos (fila justa); resolvidos no fim, do mais recente. */
export function sortMaintenance<T extends { status: string; priority: string; createdAt: string; resolvedAt: string | null }>(rows: readonly T[]) {
  const weight = (priority: string) => Math.max(0, MAINTENANCE_PRIORITIES.indexOf(priority as MaintenancePriority));
  return [...rows].sort((a, b) => {
    const activeA = isActiveMaintenance(a.status);
    const activeB = isActiveMaintenance(b.status);
    if (activeA !== activeB) return activeA ? -1 : 1;
    if (activeA) return weight(b.priority) - weight(a.priority) || a.createdAt.localeCompare(b.createdAt);
    return (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt);
  });
}

/** Há quanto tempo está aberto, em texto curto ("3 h", "2 dias"). */
export function openFor(createdAt: string, now: number) {
  const hours = Math.max(0, (now - Date.parse(createdAt)) / 3600000);
  if (hours < 1) return "menos de 1 h";
  if (hours < 24) return `${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

// Copa: compras em lote, aviso de estoque baixo e pedidos da equipe (regras puras, testáveis).

export const MAX_TRIP_LINES = 100;
export const MAX_TRIP_QTY = 10000;
export const MAX_REQUEST_TITLE = 80;
export const MAX_REQUEST_NOTE = 400;
/** Título do assunto onde o aviso de estoque baixo é publicado no canal escolhido. */
export const STOCK_TOPIC_TITLE = "Estoque da Copa";
export const COPA_ALERTS_KEY = "copa_alerts";

export type TripLine = { itemId: number; quantity: number };

/**
 * Linhas da ida ao mercado vindas da tela: só itens válidos com quantidade positiva.
 * O mesmo item duas vezes vira uma linha só (as quantidades somam).
 */
export function parseTripLines(value: unknown): { lines: TripLine[]; error: string | null } {
  if (!Array.isArray(value) || value.length === 0) return { lines: [], error: "Marque pelo menos um item comprado." };
  if (value.length > MAX_TRIP_LINES) return { lines: [], error: `Registre no máximo ${MAX_TRIP_LINES} itens por vez.` };
  const merged = new Map<number, number>();
  for (const raw of value) {
    const entry = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const itemId = Number(entry.itemId);
    const quantity = Math.round(Number(entry.quantity) * 100) / 100;
    if (!Number.isInteger(itemId) || itemId <= 0) return { lines: [], error: "Item inválido na lista." };
    if (!Number.isFinite(quantity) || quantity <= 0) return { lines: [], error: "As quantidades precisam ser maiores que zero." };
    merged.set(itemId, (merged.get(itemId) ?? 0) + quantity);
  }
  for (const quantity of merged.values()) if (quantity > MAX_TRIP_QTY) return { lines: [], error: `Quantidade grande demais (máximo ${MAX_TRIP_QTY}).` };
  return { lines: [...merged].map(([itemId, quantity]) => ({ itemId, quantity })), error: null };
}

/** O saldo acabou de cair para o mínimo ou abaixo (antes estava acima): hora de avisar. */
export function crossedLow(before: number, after: number, minimum: number) {
  return before > minimum && after <= minimum;
}

const fmt = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

/** "Café acabou." ou "Café está no mínimo: resta 1 pacote (mínimo 2)." */
export function lowStockText(item: { name: string; unit: string; minimumQty: number }, available: number) {
  if (available <= 0) return `${item.name} acabou.`;
  return `${item.name} está acabando: ${available === 1 ? "resta" : "restam"} ${fmt(available)} ${item.unit} (mínimo ${fmt(item.minimumQty)}).`;
}

export type CopaAlerts = { memberIds: number[]; channelId: number | null };

/** Configuração dos avisos (guardada como JSON): quem recebe no sino e em qual canal publicar. */
export function parseCopaAlerts(value: unknown): CopaAlerts {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch { parsed = {}; }
  const ids = Array.isArray(parsed.memberIds) ? parsed.memberIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
  const channelId = Number(parsed.channelId);
  return { memberIds: [...new Set(ids)].slice(0, 50), channelId: Number.isInteger(channelId) && channelId > 0 ? channelId : null };
}

export type RequestStatus = "open" | "approved" | "declined";
export const isRequestStatus = (value: unknown): value is RequestStatus => value === "open" || value === "approved" || value === "declined";
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { open: "Aguardando", approved: "Aprovado", declined: "Recusado" };

/** Texto do pedido: espaços normalizados e tamanho limitado. Nome vazio ou curto demais é erro. */
export function requestTitleError(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  if (title.length < 2) return "Escreva o que você quer pedir.";
  if (title.length > MAX_REQUEST_TITLE) return `Use até ${MAX_REQUEST_TITLE} caracteres no pedido.`;
  return null;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

/** Pedido aberto com o mesmo texto (sem acento e maiúsculas): melhor apoiar o que já existe. */
export function findSameRequest<T extends { title: string; status: string }>(requests: readonly T[], title: string) {
  const key = fold(title);
  return requests.find((request) => request.status === "open" && fold(request.title) === key) ?? null;
}

/** Abertos primeiro, os mais apoiados no topo; depois os decididos, do mais recente. */
export function sortRequests<T extends { status: string; votes: number; createdAt: string; decidedAt: string | null; id: number }>(requests: readonly T[]) {
  return [...requests].sort((a, b) => {
    const openA = a.status === "open" ? 0 : 1;
    const openB = b.status === "open" ? 0 : 1;
    if (openA !== openB) return openA - openB;
    if (openA === 0) return b.votes - a.votes || a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
    return (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "") || b.id - a.id;
  });
}

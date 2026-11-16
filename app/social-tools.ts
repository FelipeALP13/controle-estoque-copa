// Regras puras (sem banco) do chat da equipe. Não importa outros arquivos do app: os testes usam direto.

export const REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"] as const;

/** Emojis do seletor (mensagem e reações), por grupo. */
export const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: "Rostos", emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😋", "😛", "😜", "🤪", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "😌", "😔", "😪", "😴", "😷", "🤒", "🤯", "🥳", "😎", "🤓", "🧐", "😕", "😟", "😮", "😯", "😲", "😳", "🥺", "😢", "😭", "😱", "😖", "😤", "😡", "🤬", "💀", "🤡", "👻", "🤖"] },
  { label: "Gestos", emojis: ["👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "👋", "🤚", "✋", "🖐️", "👏", "🙌", "🤝", "🙏", "💪", "🫡", "🫶", "👀"] },
  { label: "Coisas", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "💯", "🔥", "✨", "⭐", "🎉", "🎊", "🎂", "🎁", "🏆", "🥇", "⚽", "🍕", "🍔", "🍟", "☕", "🍺", "🍻", "🥂", "💻", "🖥️", "⌨️", "🖱️", "📱", "🐛", "🚀", "⚠️", "✅", "❌", "❓", "❗", "💡", "📌", "📎", "🔒", "⏰", "📅", "💰", "🤑"] },
];
const EMOJI_SET = new Set(EMOJI_GROUPS.flatMap((group) => group.emojis));
export const isReaction = (value: unknown): value is string => typeof value === "string" && EMOJI_SET.has(value);
export const MAX_ATTACHMENTS = 4;
export const ONLINE_MS = 2 * 60 * 1000;
export const TYPING_MS = 6000;

export const MAX_MESSAGE = 2000;
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Nome de canal: minúsculas, sem acento, espaços viram hífen, só letras, números e hífen. */
export function channelSlug(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
    .replace(/^#+/, "").replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

/** Chave da conversa direta entre duas pessoas (a mesma nos dois sentidos). */
export function dmKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function dmMembers(key: string | null) {
  const match = /^(\d+):(\d+)$/.exec(key ?? "");
  return match ? [Number(match[1]), Number(match[2])] : [];
}

/** Junta mensagens seguidas da mesma pessoa (até 5 minutos entre elas), como num chat. */
export function groupMessages<T extends { id: number; memberId: number | null; createdAt: string; replyToId?: number | null }>(messages: readonly T[]) {
  const groups: { memberId: number | null; startedAt: string; items: T[] }[] = [];
  for (const message of messages) {
    const last = groups[groups.length - 1];
    const previous = last?.items[last.items.length - 1];
    const sameDay = previous && previous.createdAt.slice(0, 10) === message.createdAt.slice(0, 10);
    if (last && previous && last.memberId === message.memberId && sameDay && !message.replyToId && Date.parse(message.createdAt) - Date.parse(previous.createdAt) <= GROUP_WINDOW_MS) last.items.push(message);
    else groups.push({ memberId: message.memberId, startedAt: message.createdAt, items: [message] });
  }
  return groups;
}

/** Reações agrupadas: emoji, quantas, se eu reagi e quem reagiu (para a dica ao passar o mouse). */
export function groupReactions(rows: readonly { emoji: string; memberId: number }[], meId: number, nameOf: (id: number) => string) {
  // Na ordem do seletor de emojis (os rápidos primeiro); qualquer emoji usado aparece.
  const order = [...REACTIONS, ...EMOJI_GROUPS.flatMap((group) => group.emojis)];
  const used = [...new Set(rows.map((row) => row.emoji))].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  return used.map((emoji) => {
    const who = rows.filter((row) => row.emoji === emoji);
    return { emoji, count: who.length, mine: who.some((row) => row.memberId === meId), names: who.map((row) => nameOf(row.memberId)) };
  }).filter((entry) => entry.count > 0);
}

/** Trechos de texto e links (http/https), para mostrar links clicáveis sem HTML. */
export function splitLinks(text: string) {
  const parts: { text: string; href: string | null }[] = [];
  const pattern = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), href: null });
    parts.push({ text: match[0], href: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), href: null });
  return parts;
}


export type ChatAttachment = { kind: "upload"; key: string } | { kind: "gif"; url: string; width: number; height: number };

/** Anexos aceitos numa mensagem: fotos/GIFs enviados para o chat e GIFs do Giphy (só do domínio de mídia deles). */
export function parseChatAttachments(value: unknown): ChatAttachment[] {
  const list = Array.isArray(value) ? value : [];
  const out: ChatAttachment[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (item.kind === "upload" && typeof item.key === "string" && /^media\/chat\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(item.key)) out.push({ kind: "upload", key: item.key });
    if (item.kind === "gif" && typeof item.url === "string" && /^https:\/\/media\d?\.giphy\.com\/media\/[\w/.-]+\.(gif|webp)(\?[\w=&.-]*)?$/.test(item.url)) {
      const size = (input: unknown) => Math.max(0, Math.min(2000, Math.round(Number(input) || 0)));
      out.push({ kind: "gif", url: item.url, width: size(item.width), height: size(item.height) });
    }
  }
  return out.slice(0, MAX_ATTACHMENTS);
}

/** Resultado da busca do Giphy no formato da tela (só o necessário). */
export function mapGiphy(json: unknown) {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const images = (entry as { images?: Record<string, { url?: string; width?: string; height?: string }> }).images;
    const full = images?.fixed_height ?? images?.downsized;
    const preview = images?.fixed_height_small ?? full;
    const id = String((entry as { id?: unknown }).id ?? "");
    const title = String((entry as { title?: unknown }).title ?? "");
    if (!full?.url || !preview?.url) return [];
    const url = full.url.split("?")[0];
    return [{ id, title, url, preview: preview.url.split("?")[0], width: Number(full.width) || 0, height: Number(full.height) || 0 }];
  });
}

export type Inline = { type: "text" | "bold" | "italic" | "strike" | "code" | "spoiler" | "underline"; text: string };
export type Block = { type: "paragraph"; inline: Inline[] } | { type: "quote"; inline: Inline[] } | { type: "codeblock"; text: string };

/** Formatação no estilo do chat: **negrito**, *itálico*, __sublinhado__, ~~riscado~~, `código`, ||spoiler||, > citação e blocos ```. Sem HTML. */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const parts = text.split(/```(?:[a-z0-9]+\n)?([\s\S]*?)```/i);
  parts.forEach((part, index) => {
    if (index % 2 === 1) { blocks.push({ type: "codeblock", text: part.replace(/^\n|\n$/g, "") }); return; }
    if (!part) return;
    let paragraph: string[] = [];
    const flush = () => { if (paragraph.length) { blocks.push({ type: "paragraph", inline: parseInline(paragraph.join("\n")) }); paragraph = []; } };
    for (const line of part.split("\n")) {
      const quote = /^>\s?(.*)$/.exec(line);
      if (quote) { flush(); blocks.push({ type: "quote", inline: parseInline(quote[1]) }); }
      else paragraph.push(line);
    }
    flush();
  });
  // Tira linhas vazias das pontas que sobram entre blocos.
  return blocks.map((block) => block.type === "paragraph" ? { ...block, inline: trimInline(block.inline) } : block).filter((block) => block.type !== "paragraph" || block.inline.some((piece) => piece.text));
}

function trimInline(list: Inline[]) {
  if (!list.length) return list;
  const copy = list.map((piece) => ({ ...piece }));
  copy[0].text = copy[0].text.replace(/^\n+/, "");
  copy[copy.length - 1].text = copy[copy.length - 1].text.replace(/\n+$/, "");
  return copy.filter((piece) => piece.text);
}

export function parseInline(text: string): Inline[] {
  const pattern = /(`[^`\n]+`)|(\|\|[^|]+?\|\|)|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(~~[^~]+?~~)|(\*[^*\s][^*]*?\*)|(\b_[^_\s][^_]*?_\b)/g;
  const out: Inline[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) out.push({ type: "text", text: text.slice(cursor, start) });
    const token = match[0];
    if (match[1]) out.push({ type: "code", text: token.slice(1, -1) });
    else if (match[2]) out.push({ type: "spoiler", text: token.slice(2, -2) });
    else if (match[3]) out.push({ type: "bold", text: token.slice(2, -2) });
    else if (match[4]) out.push({ type: "underline", text: token.slice(2, -2) });
    else if (match[5]) out.push({ type: "strike", text: token.slice(2, -2) });
    else out.push({ type: "italic", text: token.slice(1, -1) });
    cursor = start + token.length;
  }
  if (cursor < text.length) out.push({ type: "text", text: text.slice(cursor) });
  return out;
}

/** Quem está digitando, em texto ("Ana está digitando…", "Ana e Bruno estão…", "Várias pessoas estão…"). */
export function typingText(names: readonly string[]) {
  const first = names.map((name) => name.split(/\s+/)[0]);
  if (!first.length) return "";
  if (first.length === 1) return `${first[0]} está digitando…`;
  if (first.length <= 3) return `${first.slice(0, -1).join(", ")} e ${first[first.length - 1]} estão digitando…`;
  return "Várias pessoas estão digitando…";
}

// ---------- Status no chat ----------

export const STATUS_KINDS = ["meeting", "lunch", "client", "away"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];
export const STATUS_LABELS: Record<StatusKind, string> = { meeting: "Em reunião", lunch: "Almoço", client: "Atendendo cliente", away: "Ausente" };
export const isStatusKind = (value: unknown): value is StatusKind => typeof value === "string" && (STATUS_KINDS as readonly string[]).includes(value);
/** Por quanto tempo vale o status escolhido. */
export const STATUS_DURATIONS = [{ key: "30m", label: "30 minutos" }, { key: "1h", label: "1 hora" }, { key: "2h", label: "2 horas" }, { key: "today", label: "Até o fim do dia" }, { key: "none", label: "Até eu tirar" }] as const;

/** Brasília não tem mais horário de verão: UTC-3 o ano todo. */
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const spDay = (date: Date) => new Date(date.getTime() - SP_OFFSET_MS).toISOString().slice(0, 10);
/** Um horário de Brasília ("2026-11-16", 9, 0) em ISO (UTC). */
export const spToIso = (day: string, hour: number, minute = 0) => new Date(Date.parse(`${day}T00:00:00Z`) + (hour * 60 + minute) * 60000 + SP_OFFSET_MS).toISOString();
/** Valor de <input type="datetime-local"> (horário de Brasília) em ISO; null se inválido. */
export function localInputToIso(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  return match ? spToIso(match[1], Number(match[2]), Number(match[3])) : null;
}

/** Até quando vale o status (ISO) para a opção escolhida; null = sem prazo; undefined = opção inválida. */
export function statusUntil(option: unknown, now: Date): string | null | undefined {
  if (option === "30m") return new Date(now.getTime() + 30 * 60000).toISOString();
  if (option === "1h") return new Date(now.getTime() + 60 * 60000).toISOString();
  if (option === "2h") return new Date(now.getTime() + 120 * 60000).toISOString();
  if (option === "today") return spToIso(spDay(now), 23, 59);
  if (option === "none" || option === undefined || option === null) return null;
  return undefined;
}

export type PersonStatus = { kind: StatusKind | "absence"; label: string; until: string | null };

/** Status que aparece na foto: férias/folga cadastradas valem mais que o escolhido; o escolhido some ao vencer. */
export function personStatus(manual: { kind: string | null; until: string | null } | null | undefined, absenceLabel: string | null, now: Date): PersonStatus | null {
  if (absenceLabel) return { kind: "absence", label: absenceLabel, until: null };
  if (!manual || !isStatusKind(manual.kind)) return null;
  if (manual.until && Date.parse(manual.until) <= now.getTime()) return null;
  return { kind: manual.kind, label: STATUS_LABELS[manual.kind], until: manual.until };
}

/** "até 14:30", "até amanhã 09:00" ou "até 20/11 18:00" (horário de Brasília). */
export function untilText(iso: string, now: Date) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - SP_OFFSET_MS).toISOString();
  const time = local.slice(11, 16);
  const day = local.slice(0, 10);
  const today = spDay(now);
  const tomorrow = spDay(new Date(now.getTime() + 86400000));
  if (day === today) return time;
  if (day === tomorrow) return `amanhã ${time}`;
  return `${day.slice(8, 10)}/${day.slice(5, 7)} ${time}`;
}

// ---------- Lembretes de mensagem ----------

export const MAX_REMINDER_DAYS = 90;

/** Atalhos de "me lembre": daqui a pouco, amanhã cedo e a próxima segunda às 9h. */
export function reminderPresets(now: Date) {
  const today = spDay(now);
  const tomorrow = spDay(new Date(now.getTime() + 86400000));
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const toMonday = ((8 - weekday) % 7) || 7;
  const monday = spDay(new Date(Date.parse(`${today}T12:00:00Z`) + toMonday * 86400000 + SP_OFFSET_MS));
  return [
    { label: "Em 20 minutos", at: new Date(now.getTime() + 20 * 60000).toISOString() },
    { label: "Em 1 hora", at: new Date(now.getTime() + 60 * 60000).toISOString() },
    { label: "Em 3 horas", at: new Date(now.getTime() + 180 * 60000).toISOString() },
    { label: "Amanhã às 9h", at: spToIso(tomorrow, 9) },
    ...(toMonday > 1 ? [{ label: weekday === 1 ? "Próxima segunda às 9h" : "Segunda às 9h", at: spToIso(monday, 9) }] : []),
  ];
}

/** Hora do lembrete válida: no futuro (com folga de 1 min) e em até 90 dias. */
export function reminderError(at: unknown, now: Date) {
  const time = typeof at === "string" ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return "Escolha quando lembrar.";
  if (time < now.getTime() + 60000) return "Escolha um horário no futuro.";
  if (time > now.getTime() + MAX_REMINDER_DAYS * 86400000) return `Lembretes valem por até ${MAX_REMINDER_DAYS} dias.`;
  return null;
}

/** Título da demanda criada a partir de uma mensagem: a primeira linha, sem formatação, em até 120 caracteres. */
export function taskTitleFromMessage(body: string) {
  const line = body.replace(/```[\s\S]*?```/g, " ").split("\n").map((part) => part.replace(/^>\s?/, "").replace(/[*_~`|]/g, "").trim()).find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
}

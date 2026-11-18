// Regras puras (sem banco) dos elogios ("kudos") e das enquetes rápidas. Não importa outros arquivos do app.

// ---------- Elogios ----------

export const KUDOS_VALUES = [
  { key: "team", label: "Colaboração", emoji: "🤝" },
  { key: "extra", label: "Foi além", emoji: "🚀" },
  { key: "client", label: "Cuidou do cliente", emoji: "💬" },
  { key: "solved", label: "Resolveu o difícil", emoji: "🧩" },
  { key: "teach", label: "Ensinou algo", emoji: "📚" },
  { key: "mood", label: "Alegrou o time", emoji: "☀️" },
] as const;
export type KudosValue = (typeof KUDOS_VALUES)[number]["key"];
export const isKudosValue = (value: unknown): value is KudosValue => KUDOS_VALUES.some((entry) => entry.key === value);
export const kudosValue = (key: string) => KUDOS_VALUES.find((entry) => entry.key === key) ?? null;
export const MAX_KUDOS_MESSAGE = 400;
/** Para não virar spam: até 10 elogios por pessoa por dia. */
export const MAX_KUDOS_PER_DAY = 10;

/** Erro do elogio (ou null): precisa de alguém, não pode ser a si mesmo e precisa de uma mensagem. */
export function kudosError(input: { fromId: number; toId: number; message: string; value: string }) {
  if (!Number.isInteger(input.toId) || input.toId <= 0) return "Escolha quem você quer elogiar.";
  if (input.toId === input.fromId) return "O elogio é para um colega, não para você mesmo. 🙂";
  if (input.message.trim().length < 3) return "Conte em poucas palavras o que a pessoa fez.";
  if (input.value && !isKudosValue(input.value)) return "Escolha um dos tipos de elogio.";
  return null;
}

/** Quantos elogios cada pessoa recebeu (mais elogiados primeiro), para o destaque do mês. */
export function kudosRanking(rows: readonly { toId: number }[]) {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.toId, (counts.get(row.toId) ?? 0) + 1);
  return [...counts.entries()].map(([memberId, count]) => ({ memberId, count })).sort((a, b) => b.count - a.count || a.memberId - b.memberId);
}

// ---------- Enquetes ----------

export const MAX_POLL_QUESTION = 160;
export const MAX_POLL_OPTION = 80;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 8;

/** Opções da enquete: sem vazias nem repetidas (sem diferença de maiúsculas), até 8. */
export function cleanPollOptions(value: unknown) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    const text = String(entry ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_POLL_OPTION);
    const key = text.toLocaleLowerCase("pt-BR");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, MAX_POLL_OPTIONS);
}

export function pollError(question: string, options: readonly string[]) {
  if (question.trim().length < 3) return "Escreva a pergunta da enquete.";
  if (options.length < MIN_POLL_OPTIONS) return "Coloque pelo menos duas opções.";
  return null;
}

/** Prazo da enquete: "1h", "4h", "today" (fim do dia), "1d", "3d", "7d" ou "none" (até fechar). */
export const POLL_DURATIONS = [
  { key: "1h", label: "1 hora" }, { key: "4h", label: "4 horas" }, { key: "today", label: "Até o fim do dia" },
  { key: "1d", label: "1 dia" }, { key: "3d", label: "3 dias" }, { key: "7d", label: "1 semana" }, { key: "none", label: "Até eu encerrar" },
] as const;

/** Até quando a enquete aceita votos (ISO), null = sem prazo, undefined = opção inválida. Fim do dia = 23:59 de Brasília. */
export function pollClosesAt(option: unknown, now: Date): string | null | undefined {
  const hours = { "1h": 1, "4h": 4, "1d": 24, "3d": 72, "7d": 168 } as Record<string, number>;
  if (typeof option === "string" && hours[option]) return new Date(now.getTime() + hours[option] * 3600000).toISOString();
  if (option === "today") {
    const day = new Date(now.getTime() - 3 * 3600000).toISOString().slice(0, 10);
    return new Date(Date.parse(`${day}T23:59:00Z`) + 3 * 3600000).toISOString();
  }
  if (option === "none" || option === undefined || option === null || option === "") return null;
  return undefined;
}

export const isPollOpen = (poll: { closedAt: string | null; closesAt: string | null }, now: Date) =>
  !poll.closedAt && (!poll.closesAt || Date.parse(poll.closesAt) > now.getTime());

/** Votos válidos para a enquete: índices existentes, sem repetir; numa enquete de uma escolha, só um. */
export function cleanVote(value: unknown, optionCount: number, multiple: boolean) {
  const list = (Array.isArray(value) ? value : [value]).map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < optionCount);
  const unique = [...new Set(list)];
  return multiple ? unique : unique.slice(0, 1);
}

/** Resultado: votos por opção, total de pessoas que votaram, o que eu escolhi e quem votou (se não for anônima). */
export function pollResults(options: readonly string[], votes: readonly { memberId: number; option: number }[], meId: number, anonymous: boolean, nameOf: (id: number) => string) {
  const voters = new Set(votes.map((vote) => vote.memberId));
  return {
    voters: voters.size,
    mine: votes.filter((vote) => vote.memberId === meId).map((vote) => vote.option),
    options: options.map((label, index) => {
      const who = votes.filter((vote) => vote.option === index);
      return { label, count: who.length, percent: voters.size ? Math.round((who.length / voters.size) * 100) : 0, names: anonymous ? [] : who.map((vote) => nameOf(vote.memberId)) };
    }),
  };
}

/** Opção(ões) vencedora(s) depois de encerrada (empate devolve todas as empatadas). */
export function pollWinners(counts: readonly number[]) {
  const top = Math.max(0, ...counts);
  return top === 0 ? [] : counts.flatMap((count, index) => (count === top ? [index] : []));
}

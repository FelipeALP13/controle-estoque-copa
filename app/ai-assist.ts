// Assistente de chamados com o Claude: resumo de chamado longo e sugestão de resposta.
// Regras puras (montar o pedido e ler a resposta), sem banco e sem rede: testáveis.

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (mais capaz)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (equilíbrio)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (mais rápido e barato)" },
] as const;
export type AiModel = (typeof AI_MODELS)[number]["id"];
export const DEFAULT_AI_MODEL: AiModel = "claude-opus-5-5";
export const isAiModel = (value: unknown): value is AiModel => AI_MODELS.some((entry) => entry.id === value);
export const API_VERSION = "2026-10-21";
/** Chamado "longo": a partir de quantos registros (comentários e mudanças) vale resumir. */
export const SUMMARY_MIN_EVENTS = 4;
/** Limite por pessoa (protege os créditos): pedidos por hora. */
export const AI_CALLS_PER_HOUR = 40;

const MAX_EVENT_CHARS = 1200;
const MAX_TOTAL_CHARS = 60000;

export type AiTicket = { code: string; title: string; description: string; client: string; status: string; urgency: string; requesterName: string; createdAt: string };
export type AiEvent = { kind: string; actorName: string; body: string; createdAt: string };
export type AiArticle = { title: string; body: string };
export type AiSolved = { code: string; title: string; resolution: string };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const when = (iso: string) => {
  const ms = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? new Date(ms - 3 * 3600000).toISOString().slice(0, 16).replace("T", " ") : iso;
};

/** O chamado em texto: cabeçalho, relato e linha do tempo (do mais antigo ao mais novo, cortando o excesso do meio). */
export function ticketTranscript(ticket: AiTicket, events: readonly AiEvent[]) {
  const head = [
    `Chamado ${ticket.code}: ${ticket.title}`,
    `Situação: ${ticket.status} · Urgência: ${ticket.urgency}${ticket.client ? ` · Cliente: ${ticket.client}` : ""}`,
    `Aberto por ${ticket.requesterName} em ${when(ticket.createdAt)}`,
    "",
    "Relato inicial:",
    clip(ticket.description.trim() || "(sem descrição)", 4000),
    "",
    "Linha do tempo:",
  ].join("\n");
  const lines = events.map((event) => `- [${when(event.createdAt)}] ${event.actorName}${event.kind === "comment" ? "" : ` (${event.kind})`}: ${clip(event.body.replace(/\s+/g, " ").trim(), MAX_EVENT_CHARS)}`);
  // Muito longo: mantém o começo e o fim (o meio costuma ser repetitivo).
  let body = lines.join("\n");
  if (head.length + body.length > MAX_TOTAL_CHARS) {
    const keep = Math.floor((MAX_TOTAL_CHARS - head.length) / 2);
    body = `${body.slice(0, keep)}\n… (registros do meio omitidos) …\n${body.slice(-keep)}`;
  }
  return `${head}\n${body || "(sem registros)"}`;
}

const RULES = [
  "Você ajuda a equipe de suporte de uma empresa brasileira a acompanhar chamados internos.",
  "Responda sempre em português do Brasil, de forma direta e profissional.",
  "Use só as informações fornecidas. Não invente fatos, prazos, nomes, valores ou procedimentos.",
  "Nunca inclua senhas, tokens ou dados pessoais que apareçam no texto.",
].join("\n");

/** Pedido do resumo: "o que aconteceu até agora" em até 3 linhas. */
export function summaryRequest(ticket: AiTicket, events: readonly AiEvent[]) {
  return {
    system: `${RULES}\nTarefa: resumir o chamado em no máximo 3 linhas curtas, sem título e sem marcadores: (1) qual é o problema, (2) o que já foi feito, (3) em que pé está e qual o próximo passo (ou quem está esperando quem).`,
    user: ticketTranscript(ticket, events),
  };
}

/** Pedido da sugestão de resposta, com os artigos da base e chamados parecidos já resolvidos como fonte. */
export function replyRequest(ticket: AiTicket, events: readonly AiEvent[], articles: readonly AiArticle[], solved: readonly AiSolved[]) {
  const sources = [
    articles.length ? `Artigos da base de conhecimento:\n${articles.map((article, index) => `[Artigo ${index + 1}] ${article.title}\n${clip(article.body, 3000)}`).join("\n\n")}` : "Nenhum artigo da base parece relacionado.",
    solved.length ? `Chamados parecidos já resolvidos:\n${solved.map((entry) => `[${entry.code}] ${entry.title}\nComo foi resolvido: ${clip(entry.resolution || "(sem registro da solução)", 1500)}`).join("\n\n")}` : "Nenhum chamado parecido resolvido.",
  ].join("\n\n");
  return {
    system: `${RULES}\nTarefa: escrever uma sugestão de resposta para quem atende colar no chamado. Baseie-se nos artigos e nos chamados resolvidos fornecidos. Se eles não forem suficientes, diga em uma linha o que falta verificar em vez de inventar. Texto pronto para enviar, sem saudação longa, até 8 linhas. No fim, numa linha separada começando com "Fontes:", cite os artigos ou chamados usados (ou "Fontes: nenhuma").`,
    user: `${ticketTranscript(ticket, events)}\n\n---\n${sources}`,
  };
}

/** Corpo do pedido à API de mensagens do Claude. */
export function messagesBody(model: AiModel, request: { system: string; user: string }, effort: "low" | "medium" = "low") {
  return {
    model,
    max_tokens: 16000,
    system: request.system,
    messages: [{ role: "user", content: request.user }],
    // No Opus 5.5 o raciocínio é sempre ligado; o esforço controla a profundidade (e o custo).
    ...(model.startsWith("claude-opus") ? { output_config: { effort } } : {}),
  };
}

export type AiOutcome = { ok: true; text: string } | { ok: false; error: string };

/** Lê a resposta da API: texto final, recusa, corte por tamanho ou erro. */
export function readAiResponse(status: number, json: unknown): AiOutcome {
  const data = (json ?? {}) as { content?: { type: string; text?: string }[]; stop_reason?: string; error?: { type?: string; message?: string } };
  if (status === 401 || status === 403) return { ok: false, error: "A chave da IA foi recusada. Um administrador precisa conferir a chave em Administração." };
  if (status === 429) return { ok: false, error: "A IA está com muitos pedidos agora. Tente de novo em um minuto." };
  if (status === 400 && data.error?.message?.toLowerCase().includes("credit")) return { ok: false, error: "Acabaram os créditos da conta da IA. Avise um administrador." };
  if (status < 200 || status >= 300) return { ok: false, error: "A IA não respondeu agora. Tente de novo em instantes." };
  if (data.stop_reason === "refusal") return { ok: false, error: "A IA não quis responder a este chamado." };
  const text = (data.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("").trim();
  if (!text) return { ok: false, error: data.stop_reason === "max_tokens" ? "A resposta ficou longa demais. Tente de novo." : "A IA respondeu vazio. Tente de novo." };
  return { ok: true, text };
}

/** Resolução de um chamado resolvido: os comentários de quem atendeu (não de quem abriu). */
export function resolutionOf(events: readonly { kind: string; actorId: number | null; body: string }[], requesterId: number | null) {
  return events.filter((event) => event.kind === "comment" && event.actorId !== requesterId).map((event) => event.body.replace(/\s+/g, " ").trim()).filter(Boolean).slice(-3).join(" / ");
}

// Integração com outros sistemas (agente N1 do AtendeChat): chaves de acesso e regras puras, testáveis.
// Com ".ts" para os testes (node --test) carregarem sem o bundler.
import { fold, parseTags, relatedArticles, searchArticles, type SearchableArticle } from "./knowledge.ts";

export const KEY_PREFIX = "pk_ac_";
export const MAX_SEARCH_RESULTS = 5;
export const MAX_ARTICLE_CHARS = 6000;
export const MAX_EXTERNAL_DESCRIPTION = 8000;
export const URGENCIES = ["low", "normal", "high", "critical"] as const;
export type ExternalUrgency = (typeof URGENCIES)[number];

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Chave nova: "pk_ac_" + 32 bytes aleatórios. Só aparece uma vez para quem criou. */
export function generateIntegrationKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${KEY_PREFIX}${base64url(bytes)}`;
}

/** O que fica salvo: o SHA-256 da chave (nunca a chave). */
export async function hashIntegrationKey(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Começo da chave para reconhecer na lista ("pk_ac_Ab12…"). */
export const keyPrefix = (key: string) => `${key.slice(0, KEY_PREFIX.length + 4)}…`;

/** "Bearer pk_ac_..." → a chave; qualquer outra coisa → null. */
export function bearerKey(header: string | null) {
  const match = /^Bearer\s+(pk_ac_[A-Za-z0-9_-]{20,100})$/.exec((header ?? "").trim());
  return match ? match[1] : null;
}

/** Etiqueta que libera artigos para a integração: sem espaços nas pontas, até 24 letras. */
export function normalizeKbTag(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 24) || "n1";
}

/** Só artigos com a etiqueta liberada: o resto da base é interno e não vai para o cliente. */
export function allowedArticles<T extends SearchableArticle>(articles: readonly T[], kbTag: string) {
  const tag = fold(kbTag);
  return articles.filter((article) => parseTags(article.tags).some((value) => fold(value) === tag));
}

/**
 * Busca para o agente: primeiro artigos com todas as palavras; se nada, os mais parecidos com a pergunta
 * (o cliente escreve em frases, não em palavras-chave).
 */
export function searchForAgent<T extends SearchableArticle>(articles: readonly T[], query: string, limit = MAX_SEARCH_RESULTS) {
  const text = String(query ?? "").trim().slice(0, 500);
  if (!text) return [];
  const exact = searchArticles(articles, text).slice(0, limit);
  if (exact.length) return exact;
  return relatedArticles(articles, text, limit);
}

export const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export type ExternalTicket = {
  title: string; description: string; urgency: ExternalUrgency;
  customerName: string; customerPhone: string; company: string;
  externalId: string; conversationUrl: string | null;
};

const text = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Chamado pedido pela integração: valida e limpa. Erro em português para o outro sistema registrar. */
export function parseExternalTicket(body: Record<string, unknown>): { ticket: ExternalTicket | null; error: string | null } {
  const title = text(body.title, 140);
  if (title.length < 3) return { ticket: null, error: "Informe um título com pelo menos 3 caracteres." };
  const description = String(body.description ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_EXTERNAL_DESCRIPTION);
  const urgency = URGENCIES.includes(body.urgency as ExternalUrgency) ? body.urgency as ExternalUrgency : "normal";
  const externalId = text(body.externalId, 60);
  if (!externalId) return { ticket: null, error: "Informe o externalId (o número do atendimento no AtendeChat)." };
  let conversationUrl: string | null = null;
  if (body.conversationUrl) {
    try {
      const url = new URL(String(body.conversationUrl));
      if (url.protocol === "https:" || url.protocol === "http:") conversationUrl = url.toString().slice(0, 500);
    } catch { /* link inválido fica de fora */ }
  }
  return {
    ticket: { title, description, urgency, customerName: text(body.customerName, 80), customerPhone: text(body.customerPhone, 30), company: text(body.company, 80), externalId, conversationUrl },
    error: null,
  };
}

/** Descrição do chamado no Portal: o resumo do agente e os dados do cliente. */
export function externalTicketDescription(ticket: ExternalTicket) {
  const who = [ticket.customerName, ticket.customerPhone].filter(Boolean).join(" · ");
  return [ticket.description, "", "—", `Aberto pelo agente N1 do AtendeChat (atendimento ${ticket.externalId}).`, who ? `Cliente: ${who}` : ""].filter((line, index, all) => line || index < all.length - 1).join("\n").trim();
}

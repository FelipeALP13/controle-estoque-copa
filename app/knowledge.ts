// Base de conhecimento e mural de avisos: regras puras (sem banco), usadas pela API, telas e testes.

export const MAX_KB_TITLE = 140;
export const MAX_KB_BODY = 20000;
export const MAX_NOTICE_TITLE = 120;
export const MAX_NOTICE_BODY = 2000;

export function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/** "Boleto, API , boleto" → ["Boleto", "API"]: sem repetir, até 8 etiquetas de 24 letras. */
export function parseTags(value: unknown) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of String(value ?? "").split(/[,;#\n]/)) {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, 24);
    if (!tag || seen.has(fold(tag))) continue;
    seen.add(fold(tag));
    tags.push(tag);
    if (tags.length === 8) break;
  }
  return tags;
}

// Palavras curtas e comuns não ajudam a achar artigos parecidos.
const STOP = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "um", "uma", "para", "por", "com", "sem", "que", "nao", "se", "ao", "ou", "mais", "pelo", "pela", "erro", "problema", "cliente", "ticket"]);

export function keywords(value: string) {
  return [...new Set(fold(value).split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP.has(word)))];
}

export type SearchableArticle = { id: number; title: string; body: string; tags: string; client: string; updatedAt: string };

/**
 * Busca: todas as palavras precisam aparecer (título, texto, etiquetas ou cliente).
 * Ordena pelo que mais casa no título e nas etiquetas; empate, o mais recente.
 */
export function searchArticles<T extends SearchableArticle>(articles: readonly T[], query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...articles].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const scored: { article: T; score: number }[] = [];
  for (const article of articles) {
    const title = fold(article.title);
    const tags = fold(`${article.tags} ${article.client}`);
    const body = fold(article.body);
    let score = 0;
    let all = true;
    for (const word of words) {
      const inTitle = title.includes(word);
      const inTags = tags.includes(word);
      const inBody = body.includes(word);
      if (!inTitle && !inTags && !inBody) { all = false; break; }
      score += (inTitle ? 5 : 0) + (inTags ? 3 : 0) + (inBody ? 1 : 0);
    }
    if (all) scored.push({ article, score });
  }
  return scored.sort((a, b) => b.score - a.score || b.article.updatedAt.localeCompare(a.article.updatedAt)).map((entry) => entry.article);
}

/** Artigos parecidos com um chamado: pelo menos 2 palavras em comum (ou 1, se o título do chamado só tiver uma). */
export function relatedArticles<T extends SearchableArticle>(articles: readonly T[], text: string, limit = 3) {
  const words = keywords(text);
  if (!words.length) return [];
  const needed = Math.min(2, words.length);
  return articles
    .map((article) => {
      const haystack = new Set(keywords(`${article.title} ${article.tags}`));
      const body = fold(article.body);
      const hits = words.filter((word) => haystack.has(word)).length;
      const bodyHits = words.filter((word) => !haystack.has(word) && body.includes(word)).length;
      return { article, hits, matched: hits + bodyHits, score: hits * 2 + bodyHits };
    })
    // Pelo menos uma palavra no título/etiquetas e, no total, o mínimo de palavras em comum.
    .filter((entry) => entry.hits >= 1 && entry.matched >= needed)
    .sort((a, b) => b.score - a.score || b.article.updatedAt.localeCompare(a.article.updatedAt))
    .slice(0, limit)
    .map((entry) => entry.article);
}

export type Notice = { id: number; important: boolean; expiresOn: string | null; createdAt: string };

/** Aviso vale até o fim do dia de validade; sem validade, fica até alguém excluir. */
export const isNoticeActive = (notice: Pick<Notice, "expiresOn">, today: string) => !notice.expiresOn || notice.expiresOn >= today;

/** Importantes primeiro, depois os mais recentes. */
export function sortNotices<T extends Notice>(notices: readonly T[]) {
  return [...notices].sort((a, b) => Number(b.important) - Number(a.important) || b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

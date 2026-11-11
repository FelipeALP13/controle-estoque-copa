// Busca geral (Ctrl+K): regras puras de comparação e ordenação, usadas pela API e pelos testes.

export type SearchKind = "task" | "ticket" | "article" | "project" | "person";
export type SearchEntry = { kind: SearchKind; id: number; title: string; subtitle: string; codes: string[]; extra?: string; closed?: boolean; updatedAt?: string };
export type SearchHit = SearchEntry & { score: number };

export const searchKindLabels: Record<SearchKind, string> = { task: "Demandas", ticket: "Chamados", article: "Base de conhecimento", project: "Projetos", person: "Pessoas" };

export function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/** "dem 12", "DEM-12" e "dem12" viram "dem-12" para comparar códigos. */
export const normalizeCode = (value: string) => fold(value).replace(/^([a-z]+)[\s-]*(\d+)$/, "$1-$2");

/**
 * Pontuação: código exato vale mais; depois título começando pela busca; depois todas as palavras
 * no título; por fim palavras espalhadas em título, detalhe e texto extra. Itens encerrados perdem um pouco.
 */
export function scoreEntry(entry: SearchEntry, query: string) {
  const q = fold(query.trim());
  if (!q) return 0;
  const code = normalizeCode(q);
  if (entry.codes.some((value) => normalizeCode(value) === code)) return 1000;
  const title = fold(entry.title);
  const words = q.split(/\s+/).filter(Boolean);
  const haystack = `${title} ${fold(entry.subtitle)} ${fold(entry.extra ?? "")} ${entry.codes.map(fold).join(" ")}`;
  if (!words.every((word) => haystack.includes(word))) return 0;
  let score = 10;
  if (title.startsWith(q)) score += 300;
  else if (title.includes(q)) score += 200;
  score += words.filter((word) => title.includes(word)).length * 40;
  if (entry.codes.some((value) => fold(value).includes(q))) score += 120;
  if (entry.closed) score -= 25;
  return Math.max(1, score);
}

/** Melhores resultados de cada tipo (até `perKind`), já ordenados. */
export function rankSearch(entries: readonly SearchEntry[], query: string, perKind = 6) {
  const hits = entries
    .map((entry) => ({ ...entry, score: scoreEntry(entry, query) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const counts = new Map<SearchKind, number>();
  return hits.filter((hit) => {
    const count = counts.get(hit.kind) ?? 0;
    if (count >= perKind) return false;
    counts.set(hit.kind, count + 1);
    return true;
  });
}

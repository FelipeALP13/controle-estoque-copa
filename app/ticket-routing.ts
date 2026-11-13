// Atribuição automática de chamados do Suporte pela escala da semana (regras puras, testáveis).

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").replace(/\.$/, "").trim();

/** Mesmo primeiro nome; nas outras partes, a mais curta precisa ser o começo da outra ("p" e "pevarello"). */
function compatible(a: string, b: string) {
  const left = a.replace(/\./g, "").split(" ");
  const right = b.replace(/\./g, "").split(" ");
  if (left[0] !== right[0]) return false;
  const length = Math.min(left.length, right.length);
  for (let index = 1; index < length; index += 1) {
    const [short, long] = left[index].length <= right[index].length ? [left[index], right[index]] : [right[index], left[index]];
    if (!long.startsWith(short)) return false;
  }
  return true;
}

/**
 * Liga os nomes escritos na escala (texto livre) às pessoas do Portal.
 * Vale o nome igual (sem acento e maiúsculas); senão, uma única pessoa com o mesmo primeiro nome e
 * sobrenomes compatíveis, abreviados de qualquer lado ("Allex" → "Allex T."; "Ana S." → "Ana Souza";
 * "Lucas Pevarello" → "Lucas P."). Nome ambíguo ou desconhecido fica de fora.
 */
export function matchScheduleNames<T extends { id: number; name: string }>(names: readonly string[], people: readonly T[]) {
  const matched: T[] = [];
  for (const raw of names) {
    const name = fold(raw);
    if (!name) continue;
    const exact = people.filter((person) => fold(person.name) === name);
    const candidates = exact.length ? exact : people.filter((person) => compatible(name, fold(person.name)));
    if (candidates.length === 1 && !matched.some((person) => person.id === candidates[0].id)) matched.push(candidates[0]);
  }
  return matched;
}

/** Quem fica com o chamado: entre os disponíveis, quem tem menos chamados abertos; empate vai pela ordem da escala. */
export function pickAssignee(candidates: readonly { id: number; open: number; away: boolean }[]) {
  const available = candidates.filter((candidate) => !candidate.away);
  if (!available.length) return null;
  return available.reduce((best, candidate) => (candidate.open < best.open ? candidate : best)).id;
}

/** O time que recebe a escala: o que se chama "Suporte" (sem diferenciar maiúsculas e acentos). */
export const isSupportTeamName = (name: string) => /^suporte\b/.test(fold(name));

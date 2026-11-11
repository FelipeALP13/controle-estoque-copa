// Férias e ausências: regras puras (sem banco), usadas pela API, pelas telas e pelos testes.

export const absenceKinds = ["vacation", "day_off", "sick", "course", "other"] as const;
export type AbsenceKind = (typeof absenceKinds)[number];
export const absenceKindLabels: Record<AbsenceKind, string> = { vacation: "Férias", day_off: "Folga", sick: "Atestado", course: "Curso / evento", other: "Ausência" };
export const isAbsenceKind = (value: unknown): value is AbsenceKind => typeof value === "string" && (absenceKinds as readonly string[]).includes(value);

/** Uma ausência cobre no máximo 60 dias e pode ser lançada até 1 ano à frente. */
export const MAX_ABSENCE_DAYS = 60;
export const MAX_NOTE = 200;

export type Absence = { id: number; memberId: number; kind: AbsenceKind; startDate: string; endDate: string; note: string };

function isIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().slice(0, 10) === value;
}

function dayNumber(isoDate: string) {
  return Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10))) / 86400000;
}

export function daysBetween(start: string, end: string) {
  return dayNumber(end) - dayNumber(start) + 1;
}

/** Valida o período. Retorna a mensagem de erro ou null. */
export function absenceRangeError(start: string, end: string, today: string) {
  if (!isIso(start) || !isIso(end)) return "Informe as datas de início e fim.";
  if (end < start) return "A data final não pode ser antes da inicial.";
  if (daysBetween(start, end) > MAX_ABSENCE_DAYS) return `Uma ausência pode ter no máximo ${MAX_ABSENCE_DAYS} dias. Para períodos maiores, registre em partes.`;
  if (dayNumber(end) < dayNumber(today) - 30) return "Só dá para registrar ausências dos últimos 30 dias em diante.";
  if (dayNumber(start) > dayNumber(today) + 366) return "Registre ausências com até um ano de antecedência.";
  return null;
}

export const rangesOverlap = (a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) => a.startDate <= b.endDate && b.startDate <= a.endDate;

/** Ausência da pessoa que cobre o dia (ou que encosta no período, se informado). */
export function absenceOn<T extends Pick<Absence, "memberId" | "startDate" | "endDate">>(absences: readonly T[], memberId: number, from: string, to = from) {
  return absences.find((absence) => absence.memberId === memberId && rangesOverlap(absence, { startDate: from, endDate: to })) ?? null;
}

/** "15/11" ou "15/11/2027" quando o ano é outro. */
export function shortDay(isoDate: string, today: string) {
  const [year, month, day] = isoDate.split("-");
  return year === today.slice(0, 4) ? `${day}/${month}` : `${day}/${month}/${year}`;
}

/** Texto curto: "Férias até 20/11", "Folga em 15/11", "Férias de 01/12 a 20/12". */
export function describeAbsence(absence: Pick<Absence, "kind" | "startDate" | "endDate">, today: string) {
  const label = absenceKindLabels[absence.kind];
  if (absence.startDate === absence.endDate) return `${label} em ${shortDay(absence.startDate, today)}`;
  if (absence.startDate <= today) return `${label} até ${shortDay(absence.endDate, today)}`;
  return `${label} de ${shortDay(absence.startDate, today)} a ${shortDay(absence.endDate, today)}`;
}

/** Fora hoje e próximas (que começam em até `days` dias), em ordem de início. */
export function splitAbsences<T extends Pick<Absence, "startDate" | "endDate">>(absences: readonly T[], today: string, days = 30) {
  const limit = new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const sorted = [...absences].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return {
    now: sorted.filter((absence) => absence.startDate <= today && absence.endDate >= today),
    upcoming: sorted.filter((absence) => absence.startDate > today && absence.startDate <= limit),
    past: sorted.filter((absence) => absence.endDate < today).reverse(),
  };
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const tokens = (value: string) => fold(value).replace(/\./g, " ").split(/\s+/).filter(Boolean);

/**
 * O nome da escala (livre, ex.: "Lucas Pevarello") é a mesma pessoa do cadastro (ex.: "Lucas P.")?
 * Aceita abreviações por inicial em qualquer parte ("L. Miguel" = "Luiz Miguel") e cadastro só com o primeiro nome.
 */
export function sameName(scheduleName: string, personName: string) {
  const a = tokens(scheduleName);
  const b = tokens(personName);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  const part = (x: string, y: string) => x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y));
  if (a.length === b.length) return a.every((token, index) => part(token, b[index]));
  if (b.length === 1) return a[0] === b[0];
  return false;
}

/** Pessoas da escala (nomes livres) que estarão ausentes no período. Nome ambíguo (casa com mais de um) é ignorado. */
export function absentInSchedule(names: readonly string[], people: readonly { id: number; name: string }[], absences: readonly Absence[], from: string, to: string) {
  const result: { name: string; absence: Absence }[] = [];
  for (const name of names) {
    const matches = people.filter((person) => sameName(name, person.name));
    if (matches.length !== 1) continue;
    const memberId = matches[0].id;
    const absence = absenceOn(absences, memberId, from, to);
    if (absence) result.push({ name, absence });
  }
  return result;
}

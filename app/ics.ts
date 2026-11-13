// Calendário no formato iCalendar (.ics), para assinar no Outlook/Teams/Google: regras puras.

export type IcsEvent = {
  id: number; title: string; notes: string; startsAt: string; endsAt: string | null; kind: string;
  teamsUrl: string; repeat: string; repeatUntil: string | null; organizer: string; updatedAt: string;
};

/** Data/hora em UTC no formato do iCalendar: 20261112T170000Z. */
export const icsTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escapa texto (\, ; , e quebras de linha). */
export const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Quebra linhas com mais de 75 bytes (regra do formato), sem partir caracteres acentuados. */
export function foldLine(line: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = parts.length ? 74 : 75; // as continuações começam com um espaço
    if (encoder.encode(current + char).length > limit) { parts.push(current); current = ""; }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Regra de repetição; "Até" vale até o fim daquele dia (Brasília). */
export function rrule(repeat: string, until: string | null) {
  const base = repeat === "daily" ? "FREQ=DAILY" : repeat === "weekdays" ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" : repeat === "weekly" ? "FREQ=WEEKLY" : repeat === "monthly" ? "FREQ=MONTHLY" : "";
  if (!base) return null;
  return until ? `${base};UNTIL=${icsTime(`${until}T23:59:59-03:00`)}` : base;
}

export function buildCalendar(name: string, events: readonly IcsEvent[], now = new Date().toISOString()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Portal da Equipe//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`,
    "X-WR-TIMEZONE:America/Sao_Paulo",
    // Pede para o Outlook/Google buscar de novo a cada hora.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of events) {
    const end = event.endsAt ?? new Date(Date.parse(event.startsAt) + (event.kind === "meeting" ? 30 : 15) * 60000).toISOString();
    const description = [event.notes, event.teamsUrl ? `Entrar no Teams: ${event.teamsUrl}` : "", event.organizer ? `Criado por ${event.organizer} no Portal da Equipe` : ""].filter(Boolean).join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:agenda-${event.id}@portal-da-equipe`,
      `DTSTAMP:${icsTime(now)}`,
      `LAST-MODIFIED:${icsTime(event.updatedAt)}`,
      `DTSTART:${icsTime(event.startsAt)}`,
      `DTEND:${icsTime(end)}`,
      `SUMMARY:${icsText(event.title)}`,
    );
    if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
    if (event.teamsUrl) lines.push(`LOCATION:${icsText("Microsoft Teams")}`, `URL:${event.teamsUrl}`);
    const rule = rrule(event.repeat, event.repeatUntil);
    if (rule) lines.push(`RRULE:${rule}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** O link leva "id.token"; só o resumo (hash) do token fica no banco. */
export function parseCalendarToken(value: string | null) {
  const match = (value ?? "").match(/^(\d{1,9})\.([0-9a-f]{64})$/);
  return match ? { memberId: Number(match[1]), token: match[2] } : null;
}

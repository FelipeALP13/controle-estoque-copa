import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar, foldLine, icsText, icsTime, parseCalendarToken, rrule } from "../app/ics.ts";

test("datas, textos e regras", () => {
  assert.equal(icsTime("2026-11-12T17:00:00.000Z"), "20261112T170000Z");
  assert.equal(icsText("Pauta: a, b; c\\d\nlinha 2"), "Pauta: a\\, b\\; c\\\\d\\nlinha 2");
  assert.equal(rrule("", null), null);
  assert.equal(rrule("daily", null), "FREQ=DAILY");
  assert.equal(rrule("weekdays", "2026-12-20"), "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261221T025959Z");
  assert.equal(rrule("monthly", null), "FREQ=MONTHLY");
});

test("linhas longas são quebradas sem partir acentos", () => {
  const line = `SUMMARY:${"ação ".repeat(30)}`;
  const folded = foldLine(line);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(new TextEncoder().encode(part).length <= 75);
  assert.equal(parts.map((part, index) => (index ? part.slice(1) : part)).join(""), line);
});

test("calendário completo", () => {
  const ics = buildCalendar("Agenda de Ana", [
    { id: 7, title: "Daily", notes: "", startsAt: "2026-11-12T12:00:00.000Z", endsAt: null, kind: "meeting", teamsUrl: "https://teams.microsoft.com/l/meetup-join/abc", repeat: "weekdays", repeatUntil: null, organizer: "Ana", updatedAt: "2026-11-10T10:00:00.000Z" },
    { id: 8, title: "Ligar para o cliente", notes: "Falar do boleto", startsAt: "2026-11-13T17:00:00.000Z", endsAt: "2026-11-13T17:20:00.000Z", kind: "note", teamsUrl: "", repeat: "", repeatUntil: null, organizer: "", updatedAt: "2026-11-10T10:00:00.000Z" },
  ], "2026-11-12T00:00:00.000Z");
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /UID:agenda-7@portal-da-equipe\r\n/);
  assert.match(ics, /DTSTART:20261112T120000Z\r\nDTEND:20261112T123000Z/, "reunião sem fim: 30 min");
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n/);
  assert.match(ics, /LOCATION:Microsoft Teams/);
  assert.match(ics, /DESCRIPTION:Falar do boleto/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
});

test("token do link", () => {
  const token = "a".repeat(64);
  assert.deepEqual(parseCalendarToken(`12.${token}`), { memberId: 12, token });
  assert.equal(parseCalendarToken(`12.${"a".repeat(63)}`), null);
  assert.equal(parseCalendarToken("x"), null);
  assert.equal(parseCalendarToken(null), null);
});

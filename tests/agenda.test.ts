import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel, dueStages, isoToLocal, isRealEmail, isTeamsJoinLink, localToIso, reminderText, reminderTimes, teamsMeetingLink } from "../app/agenda.ts";

test("horário de Brasília ↔ UTC", () => {
  assert.equal(localToIso("2026-11-12", "14:00"), "2026-11-12T17:00:00.000Z");
  assert.equal(localToIso("2026-11-12", "22:30"), "2026-11-13T01:30:00.000Z");
  assert.deepEqual(isoToLocal("2026-11-13T01:30:00.000Z"), { day: "2026-11-12", time: "22:30" });
  assert.equal(localToIso("2026-02-31", "10:00"), null);
  assert.equal(localToIso("2026-11-12", "25:00"), null);
  assert.equal(localToIso("ontem", "10:00"), null);
});

const event = { startsAt: "2026-11-12T17:00:00.000Z", remindBefore: 15 }; // 14h em Brasília
const at = (iso: string) => Date.parse(iso);

test("momentos de aviso", () => {
  assert.deepEqual(reminderTimes(event).map((r) => [r.stage, new Date(r.at).toISOString()]), [["before", "2026-11-12T16:45:00.000Z"], ["start", "2026-11-12T17:00:00.000Z"]]);
  assert.deepEqual(reminderTimes({ ...event, remindBefore: 0 }).map((r) => r.stage), ["start"]);
  assert.deepEqual(reminderTimes({ ...event, remindBefore: null }), []);
  assert.deepEqual(reminderTimes({ ...event, done: true }), []);
});

test("quais avisos já deveriam ter saído", () => {
  assert.deepEqual(dueStages(event, at("2026-11-12T16:30:00Z")), []); // 13h30
  assert.deepEqual(dueStages(event, at("2026-11-12T16:50:00Z")), ["before"]); // 13h50
  assert.deepEqual(dueStages(event, at("2026-11-12T17:05:00Z")), ["start"]); // passou da hora: o "antes" não vale mais
  assert.deepEqual(dueStages(event, at("2026-11-12T19:30:00Z")), []); // mais de 2 h depois: não incomoda
});

test("texto do aviso", () => {
  assert.equal(reminderText("Reunião com a Dr. Hoje", "before", 15), "Reunião com a Dr. Hoje em 15 min");
  assert.equal(reminderText("Reunião", "before", 60), "Reunião em 1 h");
  assert.equal(reminderText("Reunião", "start", 15), "Agora: Reunião");
});

test("link do Teams já preenchido", () => {
  const link = teamsMeetingLink({ subject: "Alinhamento & prazos", startsAt: "2026-11-12T17:00:00.000Z", endsAt: null, attendees: ["ana@empresa.com", "jose@pendente.local", "x"], content: "Pauta: boletos" });
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, "https://teams.microsoft.com/l/meeting/new");
  assert.equal(url.searchParams.get("subject"), "Alinhamento & prazos");
  assert.equal(url.searchParams.get("startTime"), "2026-11-12T14:00:00-03:00");
  assert.equal(url.searchParams.get("endTime"), "2026-11-12T14:30:00-03:00"); // sem fim: 30 min
  assert.equal(url.searchParams.get("attendees"), "ana@empresa.com"); // e-mails provisórios ficam de fora
  assert.equal(url.searchParams.get("content"), "Pauta: boletos");
  assert.ok(!link.includes("+"), "espaços como %20 (o Teams não entende +)");
  assert.equal(isRealEmail("ana@empresa.com"), true);
  assert.equal(isRealEmail("jose@pendente.local"), false);
});

test("link de entrar na reunião só do Teams", () => {
  assert.equal(isTeamsJoinLink("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc"), true);
  assert.equal(isTeamsJoinLink("https://teams.live.com/meet/123"), true);
  assert.equal(isTeamsJoinLink("https://teams.microsoft.com.golpe.com/x"), false);
  assert.equal(isTeamsJoinLink("javascript:alert(1)"), false);
});

test("nome do dia", () => {
  assert.equal(dayLabel("2026-11-12", "2026-11-12"), "Hoje");
  assert.equal(dayLabel("2026-11-13", "2026-11-12"), "Amanhã");
  assert.equal(dayLabel("2026-11-11", "2026-11-12"), "Ontem");
  assert.equal(dayLabel("2026-11-19", "2026-11-12"), "qui., 19/11");
  assert.equal(dayLabel("2027-01-05", "2026-11-12"), "ter., 05/01/2027");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { burndown, clientMonthSummary, hoursUsage, monitorTransition, parseSteps, portWarning, sameClientName, sortRetroItems, sprintCapacity, sprintRangeError, systemUrlError, toLocalDay, uptimePercent, workingDays } from "../app/office-tools.ts";

test("endereço do sistema", () => {
  assert.equal(systemUrlError("http://demonstracao.exemplo.com.br:8066/sge/index.jsp"), null);
  assert.equal(systemUrlError(""), null, "sem endereço é permitido");
  assert.match(systemUrlError("demonstracao.exemplo.com.br") ?? "", /http/);
  assert.match(systemUrlError("ftp://exemplo.com") ?? "", /http/);
  assert.match(systemUrlError("http://localhost:3000") ?? "", /internos/);
  assert.match(systemUrlError("http://192.168.0.10/app") ?? "", /internos/);
  assert.match(systemUrlError("http://172.20.1.1/") ?? "", /internos/);
  assert.match(systemUrlError("https://user:senha@exemplo.com") ?? "", /usuário/);
  assert.equal(portWarning("http://exemplo.com:8066/sge"), true);
  assert.equal(portWarning("https://exemplo.com/app"), false);
  assert.equal(portWarning("http://exemplo.com:8080/app"), false);
});

test("monitor só acusa queda depois de 2 falhas seguidas", () => {
  let state = { status: "up", failCount: 0 };
  const first = monitorTransition(state, false);
  assert.deepEqual(first, { status: "up", failCount: 1, changed: null });
  const second = monitorTransition(first, false);
  assert.deepEqual(second, { status: "down", failCount: 2, changed: "down" });
  assert.equal(monitorTransition(second, false).changed, null, "não avisa de novo enquanto continua fora");
  assert.deepEqual(monitorTransition(second, true), { status: "up", failCount: 0, changed: "up" });
  state = { status: "unknown", failCount: 0 };
  assert.equal(monitorTransition(state, true).changed, null, "primeira verificação não é 'voltou'");
});

test("percentual no ar", () => {
  const from = Date.parse("2026-11-01T00:00:00Z");
  const to = from + 10 * 3600000;
  assert.equal(uptimePercent([], from, to), 100);
  assert.equal(uptimePercent([{ kind: "down", at: "2026-11-01T02:00:00Z" }, { kind: "up", at: "2026-11-01T03:00:00Z" }], from, to), 90);
  assert.equal(uptimePercent([{ kind: "up", at: "2026-11-01T05:00:00Z" }], from, to, "down"), 50);
});

test("uso do pacote de horas", () => {
  assert.deepEqual(hoursUsage(10, null), { percent: null, state: "none", left: null });
  assert.equal(hoursUsage(30, 40).state, "ok");
  assert.equal(hoursUsage(32, 40).state, "warn");
  assert.deepEqual(hoursUsage(45, 40), { percent: 113, state: "over", left: -5 });
  assert.equal(sameClientName("Clínica São Lucas ", "clinica  sao lucas"), true);
  assert.equal(sameClientName("", ""), false);
});

test("resumo do mês do cliente", () => {
  const summary = clientMonthSummary({
    month: "2026-10",
    tickets: [
      { createdAt: "2026-10-05T12:00:00.000Z", resolvedAt: "2026-10-06T12:00:00.000Z", status: "resolved", firstResponseMinutes: 30, firstResponseOnTime: true },
      { createdAt: "2026-10-20T12:00:00.000Z", resolvedAt: null, status: "open", firstResponseMinutes: 90, firstResponseOnTime: false },
      { createdAt: "2026-09-28T12:00:00.000Z", resolvedAt: "2026-10-02T12:00:00.000Z", status: "resolved", firstResponseMinutes: null, firstResponseOnTime: null },
      { createdAt: "2026-11-01T02:00:00.000Z", resolvedAt: null, status: "open", firstResponseMinutes: null, firstResponseOnTime: null },
    ],
    tasksDone: 3, hours: 12.345, monthlyHours: 20,
  });
  assert.equal(summary.opened, 3, "01/11 02h UTC ainda é 31/10 em São Paulo");
  assert.equal(summary.resolved, 2);
  assert.equal(summary.slaPercent, 50);
  assert.equal(summary.avgFirstResponseMinutes, 60);
  assert.equal(summary.hours, 12.35);
  assert.equal(summary.usage.percent, 62);
  assert.equal(toLocalDay("2026-11-01 02:00:00"), "2026-10-31");
});

test("sprint: dias úteis, capacidade e queima", () => {
  assert.deepEqual(workingDays("2026-11-13", "2026-11-17"), ["2026-11-13", "2026-11-16", "2026-11-17"]);
  const capacity = sprintCapacity({ memberIds: [1, 2], absences: [{ memberId: 2, startDate: "2026-11-16", endDate: "2026-11-20" }], start: "2026-11-16", end: "2026-11-27", hoursPerDay: 6 });
  assert.equal(capacity.workingDays, 10);
  assert.deepEqual(capacity.perPerson.map((person) => person.days), [10, 5]);
  assert.equal(capacity.hours, 90);
  const chart = burndown([
    { estimatedHours: 10, status: "done", completedOn: "2026-11-17" },
    { estimatedHours: 6, status: "in_progress", completedOn: null },
    { estimatedHours: 4, status: "canceled", completedOn: null },
  ], "2026-11-16", "2026-11-20", "2026-11-18");
  assert.deepEqual(chart.map((point) => point.remaining), [16, 6, 6, null, null]);
  assert.deepEqual(chart.map((point) => point.ideal), [16, 12, 8, 4, 0]);
  assert.equal(sprintRangeError("2026-11-20", "2026-11-16"), "O fim precisa ser depois do início.");
  assert.equal(sprintRangeError("2026-11-16", "2026-11-27"), null);
});

test("retrospectiva e integração", () => {
  assert.deepEqual(sortRetroItems([{ id: 1, votes: 1 }, { id: 2, votes: 3 }, { id: 3, votes: 1 }]).map((item) => item.id), [2, 1, 3]);
  assert.deepEqual(parseSteps("- Criar usuário\n\n2. Liberar VPN\ncriar usuário\n  "), ["Criar usuário", "Liberar VPN"]);
});

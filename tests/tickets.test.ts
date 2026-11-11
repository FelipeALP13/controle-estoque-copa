import assert from "node:assert/strict";
import test from "node:test";
import { canHandleTicket, compareTickets, describeTicketEvent, formatMinutes, requesterCanSetStatus, slaStatus, ticketCode } from "../app/tickets.ts";

test("descreve o histórico do chamado", () => {
  assert.equal(describeTicketEvent("status", "waiting"), "mudou o status para Aguardando");
  assert.equal(describeTicketEvent("urgency", "critical"), "mudou a urgência para Crítica");
  assert.equal(describeTicketEvent("team", "Desenvolvimento"), "encaminhou para o time Desenvolvimento");
  assert.equal(describeTicketEvent("task", "TAR-3"), "criou a demanda TAR-3 a partir deste chamado");
});

test("gera o código do chamado", () => {
  assert.equal(ticketCode(7), "CH-7");
});

test("calcula o prazo de primeira resposta", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  assert.deepEqual(slaStatus({ createdAt: "2026-11-10T11:00:00Z", firstResponseAt: null, urgency: "critical" }, now), { state: "ok", minutesLeft: 60 });
  assert.equal(slaStatus({ createdAt: "2026-11-10 10:20:00", firstResponseAt: null, urgency: "critical" }, now).state, "warning");
  assert.deepEqual(slaStatus({ createdAt: "2026-11-10T09:00:00Z", firstResponseAt: null, urgency: "critical" }, now), { state: "breached", minutesLeft: -60 });
  assert.equal(slaStatus({ createdAt: "2026-11-10T09:00:00Z", firstResponseAt: "2026-11-10T10:30:00Z", urgency: "critical" }, now).state, "met");
  assert.equal(slaStatus({ createdAt: "2026-11-09T09:00:00Z", firstResponseAt: "2026-11-10T10:30:00Z", urgency: "normal" }, now).state, "late");
});

test("formata durações", () => {
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(135), "2 h 15 min");
  assert.equal(formatMinutes(-120), "2 h");
  assert.equal(formatMinutes(60 * 50), "2 d 2 h");
});

test("define quem atende o chamado", () => {
  assert.equal(canHandleTicket({ isAdmin: false, canEdit: true, teamIds: [1] }, 1), true);
  assert.equal(canHandleTicket({ isAdmin: false, canEdit: true, teamIds: [1] }, 2), false);
  assert.equal(canHandleTicket({ isAdmin: true, canEdit: true, teamIds: [] }, 2), true);
  assert.equal(canHandleTicket({ isAdmin: false, canEdit: false, teamIds: [2] }, 2), false);
  assert.equal(canHandleTicket({ isAdmin: false, canEdit: true, teamIds: [] }, null), true);
});

test("quem abriu só cancela ativo ou reabre resolvido", () => {
  assert.equal(requesterCanSetStatus("open", "canceled"), true);
  assert.equal(requesterCanSetStatus("resolved", "open"), true);
  assert.equal(requesterCanSetStatus("open", "resolved"), false);
  assert.equal(requesterCanSetStatus("canceled", "open"), false);
});

test("ordena a fila por situação, urgência e antiguidade", () => {
  const list = [
    { id: 1, status: "resolved" as const, urgency: "critical" as const, createdAt: "2026-11-10T08:00:00Z" },
    { id: 2, status: "open" as const, urgency: "normal" as const, createdAt: "2026-11-10T07:00:00Z" },
    { id: 3, status: "open" as const, urgency: "critical" as const, createdAt: "2026-11-10T09:00:00Z" },
    { id: 4, status: "waiting" as const, urgency: "normal" as const, createdAt: "2026-11-10T06:00:00Z" },
  ];
  assert.deepEqual([...list].sort(compareTickets).map((ticket) => ticket.id), [3, 4, 2, 1]);
});

test("prazo de solução por urgência", async () => {
  const { resolutionStatus, isTicketLate } = await import("../app/tickets.ts");
  const base = { createdAt: "2026-11-10T12:00:00.000Z", resolvedAt: null, firstResponseAt: "2026-11-10T12:30:00.000Z", urgency: "critical" as const, status: "in_progress" as const };
  // Crítica: 8 h. Às 17h ainda faltam 3 h (mais de um quarto do prazo).
  assert.deepEqual(resolutionStatus(base, new Date("2026-11-10T17:00:00.000Z")), { state: "ok", minutesLeft: 180 });
  assert.equal(resolutionStatus(base, new Date("2026-11-10T19:00:00.000Z"))?.state, "warning");
  assert.equal(resolutionStatus(base, new Date("2026-11-10T21:00:00.000Z"))?.state, "breached");
  assert.equal(isTicketLate(base, new Date("2026-11-10T21:00:00.000Z")), true);
  // Alta: 2 dias.
  assert.equal(resolutionStatus({ ...base, urgency: "high" }, new Date("2026-11-11T21:00:00.000Z"))?.state, "ok");
  assert.equal(resolutionStatus({ ...base, status: "resolved", resolvedAt: "2026-11-10T19:00:00.000Z" })?.state, "met");
  assert.equal(resolutionStatus({ ...base, status: "resolved", resolvedAt: "2026-11-10T21:00:00.000Z" })?.state, "late");
  assert.equal(resolutionStatus({ ...base, status: "canceled" }), null);
  assert.equal(isTicketLate({ ...base, status: "resolved", resolvedAt: "2026-11-12T00:00:00.000Z" }, new Date("2026-11-13T00:00:00.000Z")), false);
});

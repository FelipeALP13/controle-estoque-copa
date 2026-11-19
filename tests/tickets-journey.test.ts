import { test } from "node:test";
import assert from "node:assert/strict";
import { ticketJourney } from "../app/tickets.ts";

test("linha do tempo: chamado resolvido no prazo", () => {
  const steps = ticketJourney({ createdAt: "2026-11-19 12:00:00", firstResponseAt: "2026-11-19 13:30:00", resolvedAt: "2026-11-20 12:00:00", status: "resolved", urgency: "normal" });
  assert.deepEqual(steps.map((step) => [step.key, step.done, step.minutes, step.state]), [["open", true, 0, null], ["response", true, 90, "met"], ["end", true, 1440, "met"]]);
});

test("linha do tempo: aberto sem resposta e com prazo estourado", () => {
  const steps = ticketJourney({ createdAt: "2026-11-19 12:00:00", firstResponseAt: null, resolvedAt: null, status: "open", urgency: "critical" }, new Date("2026-11-19T15:00:00Z"));
  assert.equal(steps[1].done, false);
  assert.equal(steps[1].state, "breached");
  assert.equal(steps[2].label, "Resolvido");
  assert.equal(steps[2].done, false);
  assert.equal(steps[2].state, "ok");
});

test("linha do tempo: cancelado não tem prazo de solução", () => {
  const steps = ticketJourney({ createdAt: "2026-11-19 12:00:00", firstResponseAt: null, resolvedAt: "2026-11-19 12:30:00", status: "canceled", urgency: "low" });
  assert.equal(steps[2].label, "Cancelado");
  assert.equal(steps[2].state, null);
  assert.equal(steps[1].state, null);
});

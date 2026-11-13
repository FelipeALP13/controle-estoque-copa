import { test } from "node:test";
import assert from "node:assert/strict";
import { canRate, isRating, satisfactionSummary, stars } from "../app/ticket-rating.ts";

test("quem pode avaliar", () => {
  const ticket = { status: "resolved", source: "portal", requesterId: 3, rating: null };
  assert.equal(canRate(ticket, 3), true);
  assert.equal(canRate(ticket, 4), false, "só quem abriu");
  assert.equal(canRate({ ...ticket, status: "in_progress" }, 3), false, "só resolvido");
  assert.equal(canRate({ ...ticket, source: "jira" }, 3), false, "Jira fica de fora");
  assert.equal(canRate({ ...ticket, rating: 5 }, 3), false, "uma vez só");
  assert.equal(isRating(5), true);
  assert.equal(isRating(0), false);
  assert.equal(isRating(4.5), false);
  assert.equal(stars(4), "★★★★☆");
});

test("resumo do período", () => {
  const base = { title: "x", ratingComment: "" };
  const tickets = [
    { ...base, id: 1, assigneeId: 7, rating: 5, ratedAt: "2026-11-03T15:00:00.000Z", ratingComment: "Rápido!" },
    { ...base, id: 2, assigneeId: 7, rating: 4, ratedAt: "2026-11-10 12:00:00" },
    { ...base, id: 3, assigneeId: 8, rating: 2, ratedAt: "2026-11-20T15:00:00.000Z", ratingComment: "Demorou" },
    { ...base, id: 4, assigneeId: 8, rating: 5, ratedAt: "2026-10-30T15:00:00.000Z" }, // fora do mês
    { ...base, id: 5, assigneeId: 8, rating: null, ratedAt: null },
  ];
  const summary = satisfactionSummary(tickets, "2026-11-01", "2026-11-30");
  assert.equal(summary.total, 3);
  assert.equal(summary.average, 11 / 3);
  assert.equal(summary.satisfied, 2 / 3);
  assert.deepEqual(summary.distribution, [0, 1, 0, 1, 1]);
  assert.deepEqual(summary.byPerson, [{ assigneeId: 7, count: 2, average: 4.5 }, { assigneeId: 8, count: 1, average: 2 }]);
  assert.deepEqual(summary.comments.map((entry) => entry.comment), ["Demorou", "Rápido!"]);
  assert.equal(satisfactionSummary([], "2026-11-01", "2026-11-30").average, null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { cleanPhone, cleanText, isTeamColor, normalizeMembership, teamIdsOf } from "../app/teams.ts";

test("limpa nome, cargo e telefone", () => {
  assert.equal(cleanText("  Analista   de  Suporte ", 60), "Analista de Suporte");
  assert.equal(cleanPhone("(11) 9 8765-4321 ramal<script>"), "(11) 9 8765-4321");
  assert.equal(cleanPhone("+55 11 3000-0000"), "+55 11 3000-0000");
});

test("aceita só cores conhecidas", () => {
  assert.equal(isTeamColor("blue"), true);
  assert.equal(isTeamColor("pink"), false);
});

test("normaliza a lista de integrantes", () => {
  const valid = new Set([1, 2, 3]);
  assert.deepEqual(normalizeMembership([
    { memberId: 1, isLead: false },
    { memberId: 2 },
    { memberId: 1, isLead: true },
    { memberId: 9, isLead: true },
    "lixo",
  ], valid), [{ memberId: 1, isLead: true }, { memberId: 2, isLead: false }]);
  assert.deepEqual(normalizeMembership(null, valid), []);
});

test("lista os times de uma pessoa", () => {
  assert.deepEqual(teamIdsOf(2, [{ teamId: 1, memberId: 2 }, { teamId: 3, memberId: 2 }, { teamId: 1, memberId: 4 }]), [1, 3]);
});

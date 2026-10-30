import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsername, passwordPolicyError, validatePassword } from "../app/auth-policy.ts";

test("normaliza nomes de usuário", () => {
  assert.equal(normalizeUsername("  Suporte Equipe  "), "suporteequipe");
});

test("rejeita senhas curtas e comuns", () => {
  assert.equal(validatePassword("12345678"), false);
  assert.match(passwordPolicyError("abc123") || "", /8 caracteres/);
});

test("aceita senha com oito caracteres, letras e números", () => {
  assert.equal(validatePassword("Estoque2026"), true);
  assert.equal(passwordPolicyError("Estoque2026"), null);
});

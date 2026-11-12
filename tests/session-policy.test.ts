import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSession, deviceLabel, parseStamp } from "../app/session-policy.ts";

const at = (iso: string) => Date.parse(iso);

test("data do SQLite sem fuso é UTC", () => {
  assert.equal(parseStamp("2026-11-12 14:00:00"), at("2026-11-12T14:00:00Z"));
  assert.equal(parseStamp("2026-11-12T14:00:00.000Z"), at("2026-11-12T14:00:00Z"));
  assert.ok(Number.isNaN(parseStamp(null)));
});

test("sessão em uso é renovada por mais 30 dias", () => {
  const session = { createdAt: "2026-11-01 10:00:00", expiresAt: "2026-12-01T10:00:00.000Z", lastSeenAt: "2026-11-10T10:00:00.000Z" };
  const result = checkSession(session, at("2026-11-12T10:00:00Z"));
  assert.deepEqual(result, { valid: true, renew: true, expiresAt: "2026-12-12T10:00:00.000Z" });
});

test("usada há pouco: vale sem gravar de novo", () => {
  const session = { createdAt: "2026-11-01 10:00:00", expiresAt: "2026-12-01T10:00:00.000Z", lastSeenAt: "2026-11-12T09:55:00.000Z" };
  assert.deepEqual(checkSession(session, at("2026-11-12T10:00:00Z")), { valid: true, renew: false });
});

test("sem uso por mais de 7 dias, cai", () => {
  const session = { createdAt: "2026-11-01 10:00:00", expiresAt: "2026-12-01T10:00:00.000Z", lastSeenAt: "2026-11-02T10:00:00.000Z" };
  assert.deepEqual(checkSession(session, at("2026-11-09T10:01:00Z")), { valid: false });
  // Sessões antigas (sem registro de uso) contam a partir da criação.
  assert.deepEqual(checkSession({ ...session, lastSeenAt: null }, at("2026-11-09T10:01:00Z")), { valid: false });
});

test("vencida ou com mais de 90 dias, cai; a renovação não passa dos 90", () => {
  assert.deepEqual(checkSession({ createdAt: "2026-11-01 10:00:00", expiresAt: "2026-11-05T10:00:00.000Z", lastSeenAt: null }, at("2026-11-05T10:00:01Z")), { valid: false });
  assert.deepEqual(checkSession({ createdAt: "2026-08-01 10:00:00", expiresAt: "2026-12-01T10:00:00.000Z", lastSeenAt: "2026-11-01T10:00:00.000Z" }, at("2026-11-01T10:30:00Z")), { valid: false });
  const nearCap = checkSession({ createdAt: "2026-08-15 10:00:00", expiresAt: "2026-11-20T10:00:00.000Z", lastSeenAt: "2026-11-01T10:00:00.000Z" }, at("2026-11-01T12:00:00Z"));
  assert.deepEqual(nearCap, { valid: true, renew: true, expiresAt: "2026-11-13T10:00:00.000Z" });
});

test("nome do aparelho", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge no Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"), "Chrome no Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari no iPhone");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"), "Chrome no Android");
  assert.equal(deviceLabel(""), "Navegador desconhecido");
});

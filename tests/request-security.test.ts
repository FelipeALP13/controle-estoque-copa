import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTrustedOrigin } from "../app/request-security.ts";

const req = (headers: Record<string, string>) => new Request("https://portal.exemplo/api/tasks", { method: "POST", headers });

test("aceita pedidos do próprio Portal e recusa de outros sites", () => {
  assert.equal(hasTrustedOrigin(req({ origin: "https://portal.exemplo" })), true);
  assert.equal(hasTrustedOrigin(req({ origin: "https://golpe.exemplo" })), false);
  assert.equal(hasTrustedOrigin(req({ origin: "https://portal.exemplo.golpe.com" })), false);
  assert.equal(hasTrustedOrigin(req({ origin: "null" })), false);
  // Sem Origin: decide pelo Sec-Fetch-Site do navegador.
  assert.equal(hasTrustedOrigin(req({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(hasTrustedOrigin(req({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(hasTrustedOrigin(req({ "sec-fetch-site": "same-site" })), false);
  assert.equal(hasTrustedOrigin(req({})), true);
});

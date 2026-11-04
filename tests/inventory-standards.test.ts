import assert from "node:assert/strict";
import test from "node:test";
import { marketCategories, marketUnits } from "../app/inventory-standards.ts";

test("oferece categorias comuns de mercado sem duplicação", () => {
  assert.ok(marketCategories.includes("Mercearia"));
  assert.ok(marketCategories.includes("Bebidas"));
  assert.equal(new Set(marketCategories).size, marketCategories.length);
});

test("oferece unidades de contagem, peso e volume", () => {
  assert.ok(marketUnits.includes("unidade"));
  assert.ok(marketUnits.includes("kg"));
  assert.ok(marketUnits.includes("L"));
  assert.equal(new Set(marketUnits).size, marketUnits.length);
});

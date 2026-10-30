import test from "node:test";
import assert from "node:assert/strict";
import { calculateReorderPoint, canTransitionPurchase, reconcileStockCount, suggestedPurchaseQuantity } from "../app/inventory-policy.ts";

test("calcula reposição considerando prazo e segurança", () => {
  assert.equal(calculateReorderPoint({ minimumQty: 2, safetyStock: 1, leadTimeDays: 10, monthlyRecommendation: 9 }), 4);
  assert.equal(suggestedPurchaseQuantity({ available: 1, reorderPoint: 4, monthlyRecommendation: 9 }), 8);
});

test("concilia contagem sem criar saldo negativo", () => {
  assert.deepEqual(reconcileStockCount({ unopenedQty: 4, openedQty: 2, actualQty: 1 }), { expectedQty: 6, actualQty: 1, difference: -5, openedQty: 1, unopenedQty: 0 });
});

test("impede reabrir compra recebida ou cancelada", () => {
  assert.equal(canTransitionPurchase("needed", "ordered"), true);
  assert.equal(canTransitionPurchase("received", "ordered"), false);
  assert.equal(canTransitionPurchase("cancelled", "needed"), false);
});

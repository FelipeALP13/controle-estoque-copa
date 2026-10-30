export function calculateReorderPoint(input: { minimumQty: number; safetyStock: number; leadTimeDays: number; monthlyRecommendation?: number | null }) {
  const demandDuringLeadTime = Math.max(0, input.monthlyRecommendation ?? 0) / 30 * Math.max(0, input.leadTimeDays);
  return Math.max(Math.max(0, input.minimumQty), demandDuringLeadTime + Math.max(0, input.safetyStock));
}

export function suggestedPurchaseQuantity(input: { available: number; reorderPoint: number; monthlyRecommendation?: number | null }) {
  const target = Math.max(input.reorderPoint + 1, input.monthlyRecommendation ?? 0);
  return Math.max(1, Math.ceil(target - Math.max(0, input.available)));
}

export function reconcileStockCount(input: { unopenedQty: number; openedQty: number; actualQty: number }) {
  const actualQty = Math.max(0, input.actualQty);
  const expectedQty = Math.max(0, input.unopenedQty) + Math.max(0, input.openedQty);
  const openedQty = Math.min(Math.max(0, input.openedQty), actualQty);
  return { expectedQty, actualQty, difference: actualQty - expectedQty, openedQty, unopenedQty: actualQty - openedQty };
}

export type PurchaseStatus = "needed" | "approved" | "ordered" | "received" | "cancelled";

export function canTransitionPurchase(from: PurchaseStatus, to: PurchaseStatus) {
  if (from === to) return true;
  if (from === "received" || from === "cancelled") return false;
  if (to === "cancelled") return true;
  const order: PurchaseStatus[] = ["needed", "approved", "ordered", "received"];
  return order.indexOf(to) >= order.indexOf(from);
}

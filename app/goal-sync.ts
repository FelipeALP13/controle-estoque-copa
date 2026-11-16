// Itens de meta ligados a demandas: quando a demanda é concluída (ou reaberta), o item acompanha
// e a % da meta é recalculada. Usado pela rota de demandas e pela de metas.
import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db";
import { goalItems, goals, goalUpdates } from "../db/schema";
import { checklistPercent } from "./review-tools";
import { taskCode } from "./tasks";

type Db = ReturnType<typeof getDb>;

/** Recalcula a % das metas pelo checklist e grava. Devolve a % de cada meta. */
export async function refreshGoalPercents(db: Db, goalIds: readonly number[], now: string) {
  const result = new Map<number, number>();
  for (const goalId of new Set(goalIds)) {
    const items = await db.select({ done: goalItems.done }).from(goalItems).where(eq(goalItems.goalId, goalId));
    const percent = checklistPercent(items);
    await db.update(goals).set({ current: percent, updatedAt: now }).where(eq(goals.id, goalId));
    result.set(goalId, percent);
  }
  return result;
}

/** A demanda mudou de concluída para aberta (ou o contrário): marca ou desmarca os itens ligados a ela. */
export async function syncGoalItemsForTask(db: Db, taskId: number, done: boolean, actorName: string, now: string) {
  const items = await db.select().from(goalItems).where(and(eq(goalItems.taskId, taskId), eq(goalItems.done, !done)));
  if (!items.length) return 0;
  await db.update(goalItems).set({ done, doneByName: done ? actorName : null, doneAt: done ? now : null }).where(inArray(goalItems.id, items.map((item) => item.id)));
  const percents = await refreshGoalPercents(db, items.map((item) => item.goalId), now);
  await db.insert(goalUpdates).values(items.map((item) => ({
    goalId: item.goalId,
    value: percents.get(item.goalId) ?? 0,
    note: `${done ? "Concluiu" : "Reabriu"} pela demanda ${taskCode(taskId)}: ${item.text}`.slice(0, 300),
    byName: actorName,
    at: now,
  })));
  return items.length;
}

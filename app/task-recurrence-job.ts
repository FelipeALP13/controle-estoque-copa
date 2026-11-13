// Rotina das demandas que se repetem: quando chega a data, copia a demanda de origem
// (título, descrição, time, responsáveis, cliente, projeto, categoria, estimativa e checklist).
import { and, asc, eq, lte, min } from "drizzle-orm";
import type { getDb } from "../db";
import { notifications, taskChecklistItems, taskEvents, taskPeople, taskRecurrences, tasks } from "../db/schema";
import { dueFor, plan } from "./task-recurrence";
import { sortOrderBetween, taskCode } from "./tasks";

type Db = ReturnType<typeof getDb>;

export async function recurringTasksJob(db: Db, today: string) {
  const due = await db.select().from(taskRecurrences).where(and(eq(taskRecurrences.active, true), lte(taskRecurrences.nextOn, today))).orderBy(asc(taskRecurrences.nextOn)).limit(20);
  let created = 0;
  for (const recurrence of due) {
    const step = plan(recurrence.frequency, recurrence.day, recurrence.nextOn, today);
    if (!step.create) continue;
    const stamp = new Date().toISOString();
    // Reserva esta rodada (se outra aba/rodada já pegou, pula).
    const claimed = await db.update(taskRecurrences).set({ nextOn: step.nextOn, updatedAt: stamp })
      .where(and(eq(taskRecurrences.id, recurrence.id), eq(taskRecurrences.nextOn, recurrence.nextOn))).returning({ id: taskRecurrences.id });
    if (!claimed.length) continue;
    try {
      const [source] = await db.select().from(tasks).where(eq(tasks.id, recurrence.sourceTaskId)).limit(1);
      if (!source) continue;
      const [people, steps, [top]] = await Promise.all([
        db.select().from(taskPeople).where(eq(taskPeople.taskId, source.id)),
        db.select({ text: taskChecklistItems.text, sortOrder: taskChecklistItems.sortOrder }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, source.id)).orderBy(asc(taskChecklistItems.sortOrder)),
        db.select({ value: min(tasks.sortOrder) }).from(tasks).where(eq(tasks.status, "todo")),
      ]);
      const [task] = await db.insert(tasks).values({
        title: source.title,
        description: source.description,
        status: "todo",
        priority: source.priority,
        assigneeId: source.assigneeId,
        teamId: source.teamId,
        clientId: source.clientId,
        projectId: source.projectId,
        category: source.category,
        openedOn: today,
        startDate: today,
        dueDate: dueFor(today, recurrence.dueDays),
        estimatedHours: source.estimatedHours,
        origin: `Repetição de ${taskCode(source.id)}`,
        sortOrder: sortOrderBetween(null, top?.value ?? null),
        createdById: recurrence.createdById,
        createdByName: "Portal (repetição)",
        createdAt: stamp,
        updatedAt: stamp,
      }).returning();
      if (people.length) await db.insert(taskPeople).values(people.map((person) => ({ taskId: task.id, memberId: person.memberId, role: person.role })));
      for (let index = 0; index < steps.length; index += 20) {
        await db.insert(taskChecklistItems).values(steps.slice(index, index + 20).map((item) => ({ taskId: task.id, text: item.text, sortOrder: item.sortOrder, createdAt: stamp })));
      }
      await db.insert(taskEvents).values({ taskId: task.id, kind: "created", body: `Criada automaticamente (repetição de ${taskCode(source.id)})`, actorName: "Portal", createdAt: stamp });
      await db.update(taskRecurrences).set({ lastTaskId: task.id }).where(eq(taskRecurrences.id, recurrence.id));
      const recipients = [...new Set(people.map((person) => person.memberId))];
      if (recipients.length) await db.insert(notifications).values(recipients.map((memberId) => ({ memberId, kind: "task_assigned" as const, taskId: task.id, actorName: "Portal (repetição)", body: "", createdAt: stamp })));
      created += 1;
    } catch (error) {
      console.error("recurring task failed", recurrence.id, error);
    }
  }
  return { created };
}

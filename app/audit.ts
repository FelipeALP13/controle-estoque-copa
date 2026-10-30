import type { getDb } from "../db";
import { auditLogs } from "../db/schema";

type Db = ReturnType<typeof getDb>;

export async function writeAudit(db: Db, entry: {
  actorUserId?: string | null;
  actorName?: string;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  details?: string;
}) {
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId ?? null,
    actorName: entry.actorName ?? "Sistema",
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId === null || entry.targetId === undefined ? null : String(entry.targetId),
    details: entry.details ?? "",
  });
}

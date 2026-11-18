// Apaga os anexos (banco e arquivos) quando a demanda ou o chamado é excluído.
import { and, eq } from "drizzle-orm";
import { fileStoreOrNull } from "./file-store";
import type { getDb } from "../db";
import { attachments } from "../db/schema";

export async function removeAttachmentsOf(db: ReturnType<typeof getDb>, ownerType: "task" | "ticket", ownerId: number) {
  try {
    const rows = await db.delete(attachments).where(and(eq(attachments.ownerType, ownerType), eq(attachments.ownerId, ownerId))).returning({ key: attachments.storageKey });
    const bucket = fileStoreOrNull();
    if (bucket && rows.length) await bucket.delete(rows.map((row) => row.key));
  } catch (error) {
    console.error("attachments cleanup failed", error);
  }
}

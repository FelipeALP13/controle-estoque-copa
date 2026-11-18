// Enquetes no banco: carregar com resultado e votar. Usado pelo mural (/api/wall) e pelo chat (/api/chat).
import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db";
import { members, polls, pollVotes } from "../db/schema";
import { cleanVote, isPollOpen, pollResults, pollWinners } from "./wall-tools";

type Db = ReturnType<typeof getDb>;
type PollRow = typeof polls.$inferSelect;

export const pollOptions = (row: PollRow): string[] => {
  try { const parsed = JSON.parse(row.options); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
};

/** Enquetes com o resultado como a tela mostra. */
export async function loadPolls(db: Db, ids: readonly number[], meId: number, isAdmin: boolean, now = new Date()) {
  if (!ids.length) return [];
  const [rows, votes, people] = await Promise.all([
    db.select().from(polls).where(inArray(polls.id, [...ids])),
    db.select().from(pollVotes).where(inArray(pollVotes.pollId, [...ids])),
    db.select({ id: members.id, name: members.name }).from(members),
  ]);
  const nameOf = (id: number) => people.find((person) => person.id === id)?.name ?? "Alguém";
  return rows.map((row) => {
    const options = pollOptions(row);
    const result = pollResults(options, votes.filter((vote) => vote.pollId === row.id), meId, row.anonymous, nameOf);
    const open = isPollOpen(row, now);
    return {
      id: row.id, question: row.question, multiple: row.multiple, anonymous: row.anonymous, channelId: row.channelId,
      createdByName: row.createdByName, createdAt: row.createdAt, closesAt: row.closesAt, closedAt: row.closedAt, open,
      canClose: open && (isAdmin || row.createdById === meId), canDelete: isAdmin || row.createdById === meId,
      winners: open ? [] : pollWinners(result.options.map((option) => option.count)),
      ...result,
    };
  });
}

export type PollView = Awaited<ReturnType<typeof loadPolls>>[number];

/** Grava o voto (troca o anterior). Lista vazia tira o voto. Devolve o erro em texto ou null. */
export async function castVote(db: Db, pollId: number, memberId: number, choice: unknown, now = new Date()) {
  const [poll] = await db.select().from(polls).where(eq(polls.id, pollId)).limit(1);
  if (!poll) return "Enquete não encontrada.";
  if (!isPollOpen(poll, now)) return "Esta enquete já foi encerrada.";
  const chosen = cleanVote(choice, pollOptions(poll).length, poll.multiple);
  await db.delete(pollVotes).where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.memberId, memberId)));
  if (chosen.length) await db.insert(pollVotes).values(chosen.map((option) => ({ pollId, memberId, option }))).onConflictDoNothing();
  return null;
}

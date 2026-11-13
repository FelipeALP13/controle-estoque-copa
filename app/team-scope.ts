import type { getDb } from "../db";
import { teamMembers } from "../db/schema";

type Db = ReturnType<typeof getDb>;

/**
 * Quem a pessoa lidera: administradores, todo mundo; líderes, quem está nos times que lideram.
 * Usado no 1:1, no plano de desenvolvimento e nas metas individuais.
 */
export async function leaderScope(db: Db, memberId: number, isAdmin: boolean) {
  const memberships = await db.select({ memberId: teamMembers.memberId, teamId: teamMembers.teamId, isLead: teamMembers.isLead }).from(teamMembers);
  const ledTeams = new Set(memberships.filter((row) => row.memberId === memberId && row.isLead).map((row) => row.teamId));
  const leads = (personId: number | null | undefined) => typeof personId === "number" && personId !== memberId && memberships.some((row) => row.memberId === personId && ledTeams.has(row.teamId));
  const canManagePerson = (personId: number | null | undefined) => typeof personId === "number" && (isAdmin || leads(personId));
  const teamsOf = (personId: number) => memberships.filter((row) => row.memberId === personId).map((row) => row.teamId);
  return { memberships, ledTeams, leads, canManagePerson, teamsOf };
}

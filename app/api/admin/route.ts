import { and, desc, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { actionsInGroup, describeAction, type AuditGroup } from "../../audit-labels";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Tabelas que nunca entram na cópia (sessões, travas, tentativas de login, controle de migrações).
const SKIP_TABLES = new Set(["sessions", "auth_rate_limits", "password_reset_tokens", "app_settings", "inventory_locks", "d1_migrations", "__drizzle_migrations", "_cf_KV", "_cf_METADATA", "sqlite_sequence", "review_submissions", "pulse_submissions"]);
// Colunas secretas que nunca saem do servidor.
const SECRET_COLUMNS: Record<string, string[]> = { members: ["password_hash", "password_salt", "calendar_token_hash"], jira_connections: ["api_token", "lock_until"], client_systems: ["password_enc"], one_on_ones: ["private_notes"] };
const MAX_ROWS_PER_TABLE = 50000;

// Limites em UTC no mesmo formato gravado pelo banco ("AAAA-MM-DD HH:MM:SS"); a tela converte do horário de Brasília.
const isoStamp = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value : null);

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role !== "admin") return json({ error: "Somente administradores." }, 403);
    const params = new URL(request.url).searchParams;
    const view = params.get("view");

    if (view === "audit") {
      const from = isoStamp(params.get("from"));
      const to = isoStamp(params.get("to"));
      const group = params.get("group") as AuditGroup | null;
      const query = String(params.get("q") ?? "").trim().slice(0, 60);
      const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 2000);
      const filters = [];
      if (from) filters.push(gte(auditLogs.createdAt, from));
      if (to) filters.push(lte(auditLogs.createdAt, to));
      if (group) {
        const actions = actionsInGroup(group);
        if (actions.length) filters.push(inArray(auditLogs.action, actions));
      }
      if (query) {
        const pattern = `%${query.replace(/[%_]/g, "")}%`;
        filters.push(or(like(auditLogs.actorName, pattern), like(auditLogs.details, pattern)));
      }
      const rows = await db.select().from(auditLogs).where(filters.length ? and(...filters) : undefined).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(limit);
      return json({
        entries: rows.map((row) => {
          const info = describeAction(row.action);
          return { id: row.id, actorName: row.actorName, action: row.action, label: info.label, group: info.group, sensitive: Boolean(info.sensitive), targetType: row.targetType, targetId: row.targetId, details: row.details, createdAt: row.createdAt };
        }),
        limited: rows.length === limit,
      });
    }

    if (view === "backup") {
      // Todas as tabelas do banco, menos as de controle; colunas secretas removidas.
      const tables = await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' order by name`);
      const result: { name: string; columns: string[]; rows: unknown[][]; truncated: boolean }[] = [];
      for (const { name } of tables) {
        if (SKIP_TABLES.has(name) || !/^[a-z_][a-z0-9_]*$/i.test(name)) continue;
        const rows = await db.all<Record<string, unknown>>(sql.raw(`select * from "${name}" limit ${MAX_ROWS_PER_TABLE + 1}`));
        const secret = new Set(SECRET_COLUMNS[name] ?? []);
        const columns = rows.length ? Object.keys(rows[0]).filter((column) => !secret.has(column)) : [];
        result.push({ name, columns, rows: rows.slice(0, MAX_ROWS_PER_TABLE).map((row) => columns.map((column) => row[column] ?? null)), truncated: rows.length > MAX_ROWS_PER_TABLE });
      }
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "backup_downloaded", targetType: "database", details: `${result.length} tabelas, ${result.reduce((sum, table) => sum + table.rows.length, 0)} linhas` }).catch((error) => console.error("audit log failed", error));
      return json({ generatedAt: new Date().toISOString(), tables: result });
    }

    return json({ error: "Escolha o que consultar." }, 400);
  } catch (error) {
    console.error("admin request failed", error);
    return json({ error: "Não foi possível concluir esta operação agora." }, 500);
  }
}

/** Registra no histórico que alguém exportou o próprio histórico. */
export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active || member.role !== "admin") return json({ error: "Somente administradores." }, 403);
    const body = await readJsonBody(request, 8 * 1024 * 1024);
    if (body instanceof Response) return body;
    if (body.action !== "auditExported") return json({ error: "Ação desconhecida." }, 400);
    await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "audit_exported", targetType: "audit", details: String(body.details ?? "").slice(0, 200) });
    return json({ ok: true });
  } catch (error) {
    console.error("admin request failed", error);
    return json({ error: "Não foi possível concluir esta operação agora." }, 500);
  }
}

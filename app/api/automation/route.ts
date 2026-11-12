import { getDb } from "../../../db";
import { getSessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { isTeamsWebhook, teamsCard } from "../../alerts";
import { getSettings, postToTeams, runJobs, setSetting, SETTINGS, stockAlert } from "../../jobs";
import { hasTrustedOrigin } from "../../request-security";
import { sha256Hex } from "../../secret-box";
import { sealSecret } from "../../secret-key";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("automation request failed", error);
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a automação. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: message || "Não foi possível concluir esta operação agora." }, 500);
}

function newCronKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `portal_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function snapshot(db: ReturnType<typeof getDb>) {
  const settings = await getSettings(db);
  let lastResult: unknown = null;
  try { lastResult = JSON.parse(settings.get(SETTINGS.cronLastResult) ?? "null"); } catch { lastResult = null; }
  return {
    cronConfigured: Boolean(settings.get(SETTINGS.cronKeyHash)),
    cronLastRun: settings.get(SETTINGS.cronLastRun) ?? null,
    cronLastResult: lastResult,
    teamsConfigured: Boolean(settings.get(SETTINGS.teamsWebhook)),
    stockAlert: settings.get(SETTINGS.stockAlert) !== "0",
    lateAlert: settings.get(SETTINGS.lateAlert) === "1",
    alertHour: Number(settings.get(SETTINGS.alertHour) ?? 9),
    stockLastDay: settings.get(SETTINGS.stockLastDay) || null,
    portalUrl: settings.get(SETTINGS.portalUrl) ?? null,
  };
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role !== "admin") return json({ error: "Somente administradores." }, 403);
    return json(await snapshot(db));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role !== "admin") return json({ error: "Somente administradores." }, 403);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const audit = (what: string, details = "") => writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: what, targetType: "automation", details }).catch((error) => console.error("audit log failed", error));
    // Endereço do Portal para os links das mensagens (o do próprio pedido).
    await setSetting(db, SETTINGS.portalUrl, new URL(request.url).origin);

    if (action === "generateCronKey") {
      const key = newCronKey();
      await setSetting(db, SETTINGS.cronKeyHash, await sha256Hex(key));
      await audit("cron_key_generated");
      // A chave aparece só agora: o banco guarda apenas o resumo (hash).
      return json({ ...(await snapshot(db)), key });
    }

    if (action === "saveTeams") {
      const webhook = String(body.webhook ?? "").trim();
      if (webhook) {
        // Só no ambiente de desenvolvimento aceita um Teams simulado em 127.0.0.1 (para testes).
        const localTest = Boolean(import.meta.env?.DEV) && /^http:\/\/127\.0\.0\.1:\d+\//.test(webhook);
        if (!isTeamsWebhook(webhook) && !localTest) return json({ error: "Cole o link do Workflow do Teams (começa com https:// e termina em logic.azure.com, powerplatform.com ou webhook.office.com)." }, 400);
        await setSetting(db, SETTINGS.teamsWebhook, await sealSecret(webhook));
      }
      if (body.removeWebhook === true) await setSetting(db, SETTINGS.teamsWebhook, "");
      const hour = Math.round(Number(body.alertHour));
      if (Number.isFinite(hour) && hour >= 0 && hour <= 23) await setSetting(db, SETTINGS.alertHour, String(hour));
      if (typeof body.stockAlert === "boolean") await setSetting(db, SETTINGS.stockAlert, body.stockAlert ? "1" : "0");
      if (typeof body.lateAlert === "boolean") await setSetting(db, SETTINGS.lateAlert, body.lateAlert ? "1" : "0");
      await audit("teams_settings_updated", webhook ? "link do Teams trocado" : "");
      return json(await snapshot(db));
    }

    if (action === "testTeams") {
      const settings = await getSettings(db);
      const webhook = settings.get(SETTINGS.teamsWebhook);
      if (!webhook) return json({ error: "Salve o link do Teams primeiro." }, 400);
      await postToTeams(webhook, teamsCard("Teste do Portal da Equipe", `Mensagem de teste enviada por ${member.name}. Se você está vendo isto, os alertas vão chegar neste canal.`, []));
      return json({ ok: true });
    }

    if (action === "sendStockNow") {
      const result = await stockAlert(db, new Date(), await getSettings(db), true);
      return json({ ok: true, result });
    }

    if (action === "runNow") {
      const result = await runJobs(db, { recordRun: true });
      await audit("jobs_run_manually");
      return json({ result, ...(await snapshot(db)) });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}

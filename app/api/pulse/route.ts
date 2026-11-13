import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, members, pulseAnswers, pulseSubmissions, pulseSurveys } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline } from "../../tasks";
import { writeAudit } from "../../audit";
import { validScores } from "../../review-tools";
import { averageScores, MAX_PULSE_COMMENT, parseQuestions, PULSE_MIN, pulseMonth } from "../../people-tools";
import { ensurePulse, PULSE_ENABLED_KEY, PULSE_QUESTIONS_KEY, pulseSettings, surveyQuestions } from "../../pulse-store";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("pulse request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a pesquisa de clima. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";
    const today = todayInSaoPaulo();
    const settings = await pulseSettings(db);
    const current = await ensurePulse(db, today);
    let currentInfo = null;
    if (current) {
      const submissions = await db.select({ memberId: pulseSubmissions.memberId }).from(pulseSubmissions).where(eq(pulseSubmissions.surveyId, current.id));
      const total = (await db.select({ id: members.id }).from(members).where(eq(members.active, true))).length;
      currentInfo = { id: current.id, month: current.month, questions: surveyQuestions(current), answered: submissions.some((row) => row.memberId === member.id), responses: submissions.length, people: total };
    }
    // Resultados só de meses encerrados, para ninguém deduzir quem respondeu pela hora.
    const past = await db.select().from(pulseSurveys).where(lt(pulseSurveys.month, pulseMonth(today))).orderBy(desc(pulseSurveys.month)).limit(12);
    const answers = past.length ? await db.select().from(pulseAnswers).where(inArray(pulseAnswers.surveyId, past.map((survey) => survey.id))) : [];
    const history = past.map((survey) => {
      const list = answers.filter((answer) => answer.surveyId === survey.id).map((answer) => { try { return { scores: JSON.parse(answer.scores) as number[], comment: answer.comment }; } catch { return { scores: [], comment: answer.comment }; } });
      const result = averageScores(list, surveyQuestions(survey));
      return { month: survey.month, ...result, comments: isAdmin && !result.hidden ? list.map((answer) => answer.comment.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")) : null };
    });
    return json({ enabled: settings.enabled, questions: settings.questions, current: currentInfo, history, minAnswers: PULSE_MIN, me: { id: member.id, isAdmin } });
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
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const today = todayInSaoPaulo();

    if (action === "submit") {
      const survey = await ensurePulse(db, today);
      if (!survey || survey.id !== Number(body.surveyId)) return json({ error: "Esta pesquisa já foi encerrada." }, 400);
      const scores = validScores(body.scores, surveyQuestions(survey).length);
      if (!scores) return json({ error: "Responda cada pergunta de 1 a 5." }, 400);
      const [already] = await db.select({ memberId: pulseSubmissions.memberId }).from(pulseSubmissions).where(and(eq(pulseSubmissions.surveyId, survey.id), eq(pulseSubmissions.memberId, member.id))).limit(1);
      if (already) return json({ error: "Você já respondeu a pesquisa deste mês." }, 409);
      // Resposta sem quem respondeu, e o registro de que já respondeu, juntos.
      await db.batch([
        db.insert(pulseSubmissions).values({ surveyId: survey.id, memberId: member.id }),
        db.insert(pulseAnswers).values({ surveyId: survey.id, scores: JSON.stringify(scores), comment: cleanMultiline(body.comment, MAX_PULSE_COMMENT) }),
      ]);
      return json({ ok: true }, 201);
    }

    if (member.role !== "admin") return json({ error: "Somente administradores configuram a pesquisa de clima." }, 403);

    if (action === "saveSettings") {
      const enabled = body.enabled !== false;
      const questions = parseQuestions(body.questions);
      if (enabled && questions.length < 1) return json({ error: "Escreva pelo menos uma pergunta." }, 400);
      const rows = [{ key: PULSE_ENABLED_KEY, value: enabled ? "true" : "false" }, ...(questions.length ? [{ key: PULSE_QUESTIONS_KEY, value: JSON.stringify(questions) }] : [])];
      for (const row of rows) await db.insert(appSettings).values({ ...row, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value: row.value, updatedAt: now } });
      // A pesquisa do mês muda junto se ninguém respondeu ainda; senão, as perguntas novas valem a partir do próximo mês.
      let appliedNow = false;
      const [survey] = await db.select().from(pulseSurveys).where(eq(pulseSurveys.month, pulseMonth(today))).limit(1);
      if (survey && questions.length) {
        const [answered] = await db.select({ id: pulseAnswers.id }).from(pulseAnswers).where(eq(pulseAnswers.surveyId, survey.id)).limit(1);
        if (!answered) { await db.update(pulseSurveys).set({ questions: JSON.stringify(questions) }).where(eq(pulseSurveys.id, survey.id)); appliedNow = true; }
      }
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "pulse_settings_saved", targetType: "pulse", details: enabled ? `${questions.length} perguntas` : "desligada" }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true, appliedNow });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}

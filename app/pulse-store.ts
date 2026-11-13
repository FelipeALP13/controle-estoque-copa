// Pesquisa de clima: cria a pesquisa do mês quando ainda não existe (pela tela ou pelas rotinas automáticas).
import { eq } from "drizzle-orm";
import type { getDb } from "../db";
import { appSettings, pulseSurveys } from "../db/schema";
import { DEFAULT_PULSE_QUESTIONS, parseQuestions, pulseMonth } from "./people-tools";

type Db = ReturnType<typeof getDb>;

export const PULSE_ENABLED_KEY = "pulse_enabled";
export const PULSE_QUESTIONS_KEY = "pulse_questions";

export async function pulseSettings(db: Db) {
  const rows = await db.select().from(appSettings);
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  let questions = DEFAULT_PULSE_QUESTIONS;
  try { const saved = parseQuestions(JSON.parse(value(PULSE_QUESTIONS_KEY) ?? "[]")); if (saved.length) questions = saved; } catch { /* usa as perguntas padrão */ }
  return { enabled: value(PULSE_ENABLED_KEY) !== "false", questions };
}

/** A pesquisa do mês de hoje (cria com as perguntas atuais, se faltar). Nada quando a pesquisa está desligada. */
export async function ensurePulse(db: Db, today: string) {
  const settings = await pulseSettings(db);
  if (!settings.enabled) return null;
  const month = pulseMonth(today);
  await db.insert(pulseSurveys).values({ month, questions: JSON.stringify(settings.questions), createdAt: new Date().toISOString() }).onConflictDoNothing();
  const [survey] = await db.select().from(pulseSurveys).where(eq(pulseSurveys.month, month)).limit(1);
  return survey ?? null;
}

export function surveyQuestions(survey: { questions: string }) {
  try { return parseQuestions(JSON.parse(survey.questions)); } catch { return []; }
}

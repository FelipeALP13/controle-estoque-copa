// Regras e rótulos dos Projetos Grandes (antiga aba da planilha da Liderança).

export const projectFarois = ["red", "yellow", "blue", "green"] as const;
export type ProjectFarol = (typeof projectFarois)[number];
export const projectFarolLabels: Record<ProjectFarol, string> = { red: "Vermelho", yellow: "Amarelo", blue: "Azul", green: "Verde" };
export const projectFarolEmoji: Record<ProjectFarol, string> = { red: "🔴", yellow: "🟡", blue: "🔵", green: "🟢" };

export const projectPhases = ["planning", "execution", "validation", "paused", "closing"] as const;
export type ProjectPhase = (typeof projectPhases)[number];
export const projectPhaseLabels: Record<ProjectPhase, string> = { planning: "Planejamento", execution: "Execução / Monitoramento", validation: "Validação", paused: "Pausado", closing: "Encerramento" };

export const isProjectFarol = (value: unknown): value is ProjectFarol => typeof value === "string" && (projectFarois as readonly string[]).includes(value);
export const isProjectPhase = (value: unknown): value is ProjectPhase => typeof value === "string" && (projectPhases as readonly string[]).includes(value);

export function projectCode(id: number) {
  return `PRJ-${id}`;
}

/** Andamento pelas demandas ligadas: canceladas não contam. */
export function projectProgress(statuses: readonly string[]) {
  const counted = statuses.filter((status) => status !== "canceled");
  const done = counted.filter((status) => status === "done").length;
  return { total: counted.length, done, percent: counted.length ? Math.round((done / counted.length) * 100) : null };
}

/** Projeto encerrado: fase "Encerramento" ou status Concluído/Cancelado. */
export function isClosedProject(project: { status: string; phase: string }) {
  return project.phase === "closing" || project.status === "done" || project.status === "canceled";
}

// Checklists e modelos de demanda: regras puras (sem banco), usadas pela API, telas e testes.

export const MAX_CHECKLIST_ITEMS = 50;
export const MAX_ITEM_LENGTH = 200;

export type ChecklistItem = { id: number; text: string; done: boolean; doneByName: string | null; doneAt: string | null; sortOrder: number };

/** Texto de um passo: uma linha, sem espaços sobrando, até 200 caracteres. */
export const cleanItem = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_LENGTH);

/**
 * Lista de passos de um modelo. Aceita JSON (como fica no banco) ou texto com um passo por linha
 * (como se digita na tela); tira marcadores ("- ", "1. ", "[ ]") e linhas vazias.
 */
export function parseItems(value: unknown): string[] {
  let lines: unknown[] = [];
  if (Array.isArray(value)) lines = value;
  else if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("[")) {
      try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) lines = parsed; } catch { lines = text.split(/\r?\n/); }
    } else lines = text.split(/\r?\n/);
  }
  return lines
    .map((line) => cleanItem(String(line ?? "").replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, "")))
    .filter(Boolean)
    .slice(0, MAX_CHECKLIST_ITEMS);
}

export function checklistProgress(items: readonly Pick<ChecklistItem, "done">[]) {
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0, complete: total > 0 && done === total };
}

/** Modelos sugeridos para começar (o administrador cria com um clique e depois ajusta). */
export const exampleTemplates = [
  {
    name: "Implantação de cliente", title: "Implantação · ", category: "Atendimento", priority: 2,
    description: "Implantação completa do sistema para um cliente novo.",
    items: ["Reunião de início com o cliente", "Receber documentação e acessos", "Configurar ambiente de homologação", "Cadastrar dados iniciais", "Treinar a equipe do cliente", "Validação do cliente em homologação", "Publicar em produção", "Acompanhar a primeira semana de uso"],
  },
  {
    name: "Publicação de versão", title: "Publicação da versão ", category: "Deploy", priority: 3,
    description: "Passo a passo para publicar uma nova versão com segurança.",
    items: ["Revisar as mudanças da versão", "Testes em homologação", "Validação do Suporte", "Avisar os clientes afetados", "Fazer cópia de segurança do banco", "Publicar em produção", "Conferir o sistema após a publicação", "Registrar a versão no histórico"],
  },
  {
    name: "Novo colaborador", title: "Entrada de ", category: "Rotina interna", priority: 3,
    description: "O que preparar para alguém que está chegando na equipe.",
    items: ["Criar usuário no Portal", "Criar e-mail e acessos aos sistemas", "Adicionar ao time e à escala", "Apresentar a equipe e os clientes", "Enviar os artigos principais da base de conhecimento", "Acompanhar a primeira semana"],
  },
] as const;

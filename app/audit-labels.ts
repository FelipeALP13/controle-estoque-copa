// Nomes em português das ações gravadas no histórico (audit_logs) e agrupamento para filtros.

export type AuditGroup = "access" | "people" | "work" | "stock" | "schedule" | "integration" | "data";

export const auditGroupLabels: Record<AuditGroup, string> = {
  access: "Acesso e segurança",
  people: "Usuários e times",
  work: "Demandas, chamados e projetos",
  stock: "Estoque",
  schedule: "Escala e ausências",
  integration: "Integrações",
  data: "Dados e cópias",
};

const actions: Record<string, { label: string; group: AuditGroup; sensitive?: boolean }> = {
  login: { label: "Entrou no sistema", group: "access" },
  logout: { label: "Saiu do sistema", group: "access" },
  other_sessions_ended: { label: "Encerrou as sessões dos outros aparelhos", group: "access", sensitive: true },
  all_sessions_ended: { label: "Encerrou todas as próprias sessões", group: "access", sensitive: true },
  sessions_ended_by_admin: { label: "Encerrou as sessões de outra pessoa", group: "access", sensitive: true },
  login_failed: { label: "Tentativa de login com senha errada", group: "access", sensitive: true },
  login_blocked: { label: "Login bloqueado por muitas tentativas", group: "access", sensitive: true },
  initial_admin_configured: { label: "Configurou o administrador inicial", group: "access", sensitive: true },
  profile_updated: { label: "Atualizou o próprio perfil", group: "people" },
  profile_and_password_updated: { label: "Trocou a própria senha", group: "access", sensitive: true },
  member_created: { label: "Criou usuário", group: "people", sensitive: true },
  member_updated: { label: "Editou usuário", group: "people" },
  member_updated_and_password_reset: { label: "Redefiniu a senha de um usuário", group: "access", sensitive: true },
  member_role_updated: { label: "Mudou a permissão de um usuário", group: "access", sensitive: true },
  member_activated: { label: "Reativou o acesso de um usuário", group: "access", sensitive: true },
  member_deactivated: { label: "Desativou o acesso de um usuário", group: "access", sensitive: true },
  member_deleted: { label: "Excluiu usuário", group: "people", sensitive: true },
  team_created: { label: "Criou time", group: "people" },
  team_updated: { label: "Editou time", group: "people" },
  team_deleted: { label: "Excluiu time", group: "people", sensitive: true },
  task_deleted: { label: "Excluiu demanda", group: "work", sensitive: true },
  ticket_deleted: { label: "Excluiu chamado", group: "work", sensitive: true },
  attachment_deleted: { label: "Excluiu um anexo", group: "work" },
  project_deleted: { label: "Excluiu projeto", group: "work", sensitive: true },
  kb_article_deleted: { label: "Excluiu artigo da base", group: "work" },
  announcement_created: { label: "Publicou aviso no mural", group: "work" },
  announcement_deleted: { label: "Tirou aviso do mural", group: "work" },
  item_created: { label: "Cadastrou item no estoque", group: "stock" },
  item_updated: { label: "Editou item do estoque", group: "stock" },
  item_deleted: { label: "Excluiu item do estoque", group: "stock", sensitive: true },
  initial_items_created: { label: "Carregou a lista inicial do estoque", group: "stock" },
  support_team_created: { label: "Criou equipe da escala", group: "schedule" },
  support_team_updated: { label: "Editou equipe da escala", group: "schedule" },
  support_team_deleted: { label: "Excluiu equipe da escala", group: "schedule" },
  support_week_created: { label: "Criou semana da escala", group: "schedule" },
  support_week_updated: { label: "Editou semana da escala", group: "schedule" },
  support_week_deleted: { label: "Excluiu semana da escala", group: "schedule" },
  support_weeks_generated: { label: "Gerou semanas da escala", group: "schedule" },
  absence_created: { label: "Registrou ausência", group: "schedule" },
  absence_deleted: { label: "Excluiu ausência", group: "schedule" },
  jira_connection_created: { label: "Conectou conta do Jira", group: "integration", sensitive: true },
  jira_connection_updated: { label: "Editou conta do Jira", group: "integration", sensitive: true },
  jira_connection_deleted: { label: "Removeu conta do Jira", group: "integration", sensitive: true },
  spreadsheets_imported: { label: "Importou planilhas de demandas", group: "data", sensitive: true },
  backup_downloaded: { label: "Baixou a cópia de segurança", group: "data", sensitive: true },
  audit_exported: { label: "Exportou o histórico de ações", group: "data" },
};

export function describeAction(action: string) {
  const known = actions[action];
  if (known) return known;
  // Ação nova ainda sem nome: mostra o código legível.
  return { label: action.replace(/_/g, " "), group: "data" as AuditGroup, sensitive: false };
}

export function actionsInGroup(group: AuditGroup) {
  return Object.entries(actions).filter(([, value]) => value.group === group).map(([key]) => key);
}

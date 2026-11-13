// Teste de permissões das APIs, de ponta a ponta, contra o Portal rodando localmente.
// Cria dois usuários temporários ("Somente leitura" e "Membro") no banco LOCAL, chama as APIs
// com cada perfil e sem login, confere que o servidor bloqueia o que deve, e apaga tudo no fim.
//
// Uso (com o Portal rodando em outra janela: npm run dev):
//   npm run test:permissions
//   PORTAL_TEST_URL=http://127.0.0.1:5173 npm run test:permissions
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.PORTAL_TEST_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error("Este teste mexe no banco local e só roda contra o Portal local (127.0.0.1 ou localhost).");
  process.exit(2);
}

function sql(command) {
  const output = execFileSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", ".wrangler/state", "--json", "--command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(output);
}

const MARK = "teste-permissao";
const people = { viewer: { role: "viewer" }, member: { role: "member" } };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const expires = new Date(Date.now() + 3600000).toISOString();
const now = new Date().toISOString();

function cleanup() {
  sql(`delete from members where user_id like '${MARK}-%';`);
}

const results = [];
async function expectStatus(label, who, method, path, body, expected, extraHeaders = {}) {
  const headers = { Origin: BASE, ...extraHeaders };
  if (who) headers.Cookie = `estoque_session=${people[who].token}`;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const ok = Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
  results.push({ ok, label, who: who ?? "sem login", got: response.status, expected });
}

try {
  cleanup();
  for (const [key, person] of Object.entries(people)) {
    person.token = randomBytes(32).toString("hex");
    sql(`insert into members (user_id, name, email, role, permissions, active) values ('${MARK}-${key}', 'Teste ${key}', '${MARK}-${key}@pendente.local', '${person.role}', '{}', 1);`);
    const [{ results: [row] }] = sql(`select id from members where user_id = '${MARK}-${key}';`);
    person.id = row.id;
    sql(`insert into sessions (member_id, token_hash, expires_at, last_seen_at, device) values (${row.id}, '${sha256(person.token)}', '${expires}', '${now}', 'Teste de permissões');`);
  }

  // Sem login: nada abre.
  for (const path of ["/api/tasks", "/api/tickets", "/api/agenda", "/api/inventory", "/api/projects", "/api/knowledge"]) await expectStatus(`ler ${path}`, null, "GET", path, null, 401);
  await expectStatus("criar demanda", null, "POST", "/api/tasks", { action: "createTask", title: "x" }, 401);
  await expectStatus("registrar ausência", null, "POST", "/api/absences", { action: "addAbsence" }, 401);

  // Pedido vindo de outro site é recusado, mesmo com login.
  await expectStatus("POST de outro site", "member", "POST", "/api/tasks", { action: "createTask", title: "x" }, 403, { Origin: "https://site-estranho.example" });

  // Somente leitura: lê, mas não altera nada.
  await expectStatus("ler demandas", "viewer", "GET", "/api/tasks", null, 200);
  for (const [path, action] of [["/api/tasks", "createTask"], ["/api/tickets", "createTicket"], ["/api/projects", "saveProject"], ["/api/knowledge", "saveArticle"], ["/api/time-entries", "addEntry"], ["/api/absences", "addAbsence"]]) {
    await expectStatus(`${action} (${path})`, "viewer", "POST", path, { action }, 403);
  }
  await expectStatus("cadastrar item do estoque", "viewer", "POST", "/api/inventory", { action: "addItem", name: "x" }, 403);

  // Só administradores (vale para leitura e membro).
  for (const who of ["viewer", "member"]) {
    await expectStatus("ver histórico e cópias", who, "GET", "/api/admin", null, 403);
    await expectStatus("baixar cópia de segurança", who, "POST", "/api/admin", { action: "backup" }, 403);
    await expectStatus("adicionar usuário", who, "POST", "/api/inventory", { action: "addMember", name: "x" }, 403);
    await expectStatus("mudar permissão", who, "POST", "/api/inventory", { action: "updateMemberRole", userId: "x", role: "admin" }, 403);
    await expectStatus("desativar usuário", who, "POST", "/api/inventory", { action: "updateMemberActive", userId: "x", active: false }, 403);
    await expectStatus("desconectar outra pessoa", who, "POST", "/api/auth", { action: "endMemberSessions", memberId: 1 }, 403);
    await expectStatus("modelos de demanda", who, "POST", "/api/templates", { action: "saveTemplate" }, 403);
    await expectStatus("importar planilha", who, "POST", "/api/import", { action: "preview" }, 403);
    await expectStatus("configurar Jira", who, "GET", "/api/jira", null, 403);
    await expectStatus("salvar conexão do Jira", who, "POST", "/api/jira", { action: "saveConnection" }, 403);
    await expectStatus("gerenciar times", who, "POST", "/api/people", { action: "saveTeam", name: "x" }, 403);
    await expectStatus("editar perfil de outra pessoa", who, "POST", "/api/people", { action: "updateProfile", memberId: 1 }, 403);
  }

  // Membro: trabalha normalmente, mas não exclui nem administra.
  await expectStatus("ler demandas", "member", "GET", "/api/tasks", null, 200);
  await expectStatus("excluir demanda", "member", "POST", "/api/tasks", { action: "deleteTask", taskId: 1 }, 403);
  await expectStatus("lista de clientes", "member", "POST", "/api/tasks", { action: "saveClient", name: "x" }, 403);
  await expectStatus("excluir chamado", "member", "POST", "/api/tickets", { action: "deleteTicket", ticketId: 1 }, 403);
  await expectStatus("excluir projeto", "member", "POST", "/api/projects", { action: "deleteProject", projectId: 1 }, 403);
  await expectStatus("publicar no mural (sem ser líder)", "member", "POST", "/api/announcements", { action: "createNotice", title: "x", body: "x" }, 403);
  await expectStatus("lançar horas de outra pessoa", "member", "POST", "/api/time-entries", { action: "addEntry", memberId: 1, taskId: 1, workDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), hours: 1 }, 403);

  // Anexos, repetição, avaliação e calendário.
  await expectStatus("ver anexos sem login", null, "GET", "/api/attachments?ownerType=task&ownerId=1", null, 401);
  await expectStatus("excluir anexo (somente leitura)", "viewer", "POST", "/api/attachments", { action: "delete", id: 1 }, 403);
  await expectStatus("repetir demanda (somente leitura)", "viewer", "POST", "/api/tasks", { action: "saveRecurrence", taskId: 1, frequency: "weekly", day: 1 }, 403);
  await expectStatus("avaliar chamado (somente leitura)", "viewer", "POST", "/api/tickets", { action: "rateTicket", ticketId: 1, rating: 5 }, 403);
  await expectStatus("calendário com link inválido", null, "GET", "/api/agenda/ics?token=1.0000000000000000000000000000000000000000000000000000000000000000", null, 404);
  await expectStatus("calendário sem link", null, "GET", "/api/agenda/ics", null, 404);

  // Respostas prontas, dependências, cronômetro, passagem de plantão e tela da TV.
  await expectStatus("criar resposta pronta (somente leitura)", "viewer", "POST", "/api/tickets", { action: "saveReply", title: "x", body: "x" }, 403);
  await expectStatus("ligar dependência (somente leitura)", "viewer", "POST", "/api/tasks", { action: "addDependency", taskId: 1, blockedById: 2 }, 403);
  await expectStatus("iniciar cronômetro (somente leitura)", "viewer", "POST", "/api/time-entries", { action: "startTimer", taskId: 1 }, 403);
  await expectStatus("registrar passagem de plantão (somente leitura)", "viewer", "POST", "/api/handoffs", { action: "createHandoff", body: "x" }, 403);
  await expectStatus("ver passagem de plantão sem login", null, "GET", "/api/handoffs", null, 401);
  await expectStatus("dados da TV sem login", null, "GET", "/api/tv", null, 401);
  await expectStatus("tela da TV sem login", null, "GET", "/tv", null, [302, 303, 307, 308]);
  await expectStatus("ler dados da TV", "viewer", "GET", "/api/tv", null, 200);
} finally {
  cleanup();
}

const failed = results.filter((result) => !result.ok);
for (const result of results) console.log(`${result.ok ? "ok  " : "FALHOU"}  [${result.who}] ${result.label}: ${result.got}${result.ok ? "" : ` (esperado ${result.expected})`}`);
console.log(`\n${results.length - failed.length} de ${results.length} verificações de permissão passaram.`);
process.exit(failed.length ? 1 : 0);

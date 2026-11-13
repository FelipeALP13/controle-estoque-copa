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
  sql(`delete from client_systems where name = '${MARK}';`);
  sql(`delete from members where user_id like '${MARK}-%';`);
}

const results = [];
async function expectStatus(label, who, method, path, body, expected, extraHeaders = {}) {
  const headers = { Origin: BASE, ...extraHeaders };
  if (who) headers.Cookie = `estoque_session=${people[who].token}`;
  if (body) headers["Content-Type"] = "application/json";
  // O servidor local às vezes derruba a conexão logo depois de o teste gravar direto no banco: tenta de novo uma vez.
  const send = () => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const response = await send().catch(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); return send(); });
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

  // Respostas prontas, dependências, cronômetro, passagem de plantão.
  await expectStatus("criar resposta pronta (somente leitura)", "viewer", "POST", "/api/tickets", { action: "saveReply", title: "x", body: "x" }, 403);
  await expectStatus("ligar dependência (somente leitura)", "viewer", "POST", "/api/tasks", { action: "addDependency", taskId: 1, blockedById: 2 }, 403);
  await expectStatus("iniciar cronômetro (somente leitura)", "viewer", "POST", "/api/time-entries", { action: "startTimer", taskId: 1 }, 403);
  await expectStatus("registrar passagem de plantão (somente leitura)", "viewer", "POST", "/api/handoffs", { action: "createHandoff", body: "x" }, 403);
  await expectStatus("ver passagem de plantão sem login", null, "GET", "/api/handoffs", null, 401);

  // Clientes e acessos, sprints, retrospectivas e integração.
  for (const path of ["/api/clients", "/api/sprints", "/api/retros", "/api/onboarding"]) await expectStatus(`ler ${path}`, null, "GET", path, null, 401);
  await expectStatus("ver senha de sistema (somente leitura)", "viewer", "POST", "/api/clients", { action: "revealPassword", systemId: 1 }, 403);
  for (const who of ["viewer", "member"]) {
    await expectStatus("cadastrar acesso de sistema", who, "POST", "/api/clients", { action: "saveSystem", clientId: 1, name: "x", environment: "demo" }, 403);
    await expectStatus("editar ficha do cliente", who, "POST", "/api/clients", { action: "saveProfile", clientId: 1 }, 403);
    await expectStatus("começar integração", who, "POST", "/api/onboarding", { action: "createOnboarding", memberId: 1, startDate: "2026-01-01", steps: "x" }, 403);
  }
  await expectStatus("criar sprint (somente leitura)", "viewer", "POST", "/api/sprints", { action: "saveSprint", name: "x", startDate: "2026-01-05", endDate: "2026-01-09" }, 403);
  await expectStatus("criar retrospectiva (somente leitura)", "viewer", "POST", "/api/retros", { action: "createRetro", title: "x" }, 403);
  await expectStatus("excluir sprint (membro)", "member", "POST", "/api/sprints", { action: "deleteSprint", sprintId: 1 }, [403, 404]);
  // Avaliação trimestral e metas.
  await expectStatus("ver avaliação sem login", null, "GET", "/api/reviews", null, 401);
  await expectStatus("ver metas sem login", null, "GET", "/api/goals", null, 401);
  for (const who of ["viewer", "member"]) {
    await expectStatus("abrir ciclo de avaliação", who, "POST", "/api/reviews", { action: "openCycle", title: "x", endDate: "2099-01-01", peerCriteria: "a", companyCriteria: "a", managerCriteria: "a" }, 403);
    await expectStatus("mudar gestão avaliada", who, "POST", "/api/reviews", { action: "saveManager", name: "x" }, 403);
  }
  await expectStatus("criar meta (somente leitura)", "viewer", "POST", "/api/goals", { action: "saveGoal", year: 2026, scope: "team", teamId: 1, title: "x", target: 1 }, 403);
  await expectStatus("criar meta de time sem ser líder", "member", "POST", "/api/goals", { action: "saveGoal", year: 2026, scope: "team", teamId: 1, title: "x", target: 1 }, 403);
  await expectStatus("criar meta individual sem ser líder", "member", "POST", "/api/goals", { action: "saveGoal", year: 2026, scope: "person", memberId: 1, title: "x", target: 1 }, 403);
  await expectStatus("resultados de ciclo inexistente", "member", "GET", "/api/reviews?results=999999", null, 404);

  // 1:1 e plano de desenvolvimento, pesquisa de clima, equipamentos e incidentes.
  for (const path of ["/api/one-on-ones", "/api/pulse", "/api/assets", "/api/incidents"]) await expectStatus(`ler ${path} sem login`, null, "GET", path, null, 401);
  await expectStatus("marcar 1:1 com quem não lidera", "member", "POST", "/api/one-on-ones", { action: "saveMeeting", memberId: 1, date: "2099-01-01" }, 403);
  await expectStatus("criar ação no plano de outra pessoa", "member", "POST", "/api/one-on-ones", { action: "saveAction", memberId: 1, title: "x" }, 403);
  await expectStatus("ler o próprio 1:1 e plano", "viewer", "GET", "/api/one-on-ones", null, 200);
  await expectStatus("responder a pesquisa de clima (somente leitura participa)", "viewer", "GET", "/api/pulse", null, 200);
  for (const who of ["viewer", "member"]) {
    await expectStatus("configurar a pesquisa de clima", who, "POST", "/api/pulse", { action: "saveSettings", enabled: false, questions: "x" }, 403);
    await expectStatus("cadastrar equipamento", who, "POST", "/api/assets", { action: "saveAsset", kind: "equipment", name: "x" }, 403);
  }
  await expectStatus("registrar incidente (somente leitura)", "viewer", "POST", "/api/incidents", { action: "saveIncident", title: "x", startedAt: "2026-01-01T10:00" }, 403);
  await expectStatus("excluir incidente (membro)", "member", "POST", "/api/incidents", { action: "deleteIncident", incidentId: 1 }, 403);

  // Senha de um acesso de outro time: membro fora do time não vê.
  const [{ results: [client] }] = sql("select id from clients limit 1;");
  const [{ results: [team] }] = sql("select id from teams limit 1;");
  if (client && team) {
    sql(`insert into client_systems (client_id, team_id, name, created_by_name) values (${client.id}, ${team.id}, '${MARK}', '${MARK}');`);
    const [{ results: [system] }] = sql(`select id from client_systems where name = '${MARK}';`);
    await expectStatus("ver senha de acesso de outro time (membro)", "member", "POST", "/api/clients", { action: "revealPassword", systemId: system.id }, 403);
    const readDetail = () => fetch(`${BASE}/api/clients?clientId=${client.id}`, { headers: { Cookie: `estoque_session=${people.member.token}` } }).then((response) => response.json());
    const detail = await readDetail().catch(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); return readDetail(); });
    const leaked = detail.systems?.find((entry) => entry.id === system.id);
    results.push({ ok: Boolean(leaked) && leaked.username === null && leaked.canSeeLogin === false, label: "usuário do acesso escondido de quem não é do time", who: "member", got: leaked ? `username=${leaked.username}` : "não listado", expected: "username=null" });
  }
} finally {
  cleanup();
}

const failed = results.filter((result) => !result.ok);
for (const result of results) console.log(`${result.ok ? "ok  " : "FALHOU"}  [${result.who}] ${result.label}: ${result.got}${result.ok ? "" : ` (esperado ${result.expected})`}`);
console.log(`\n${results.length - failed.length} de ${results.length} verificações de permissão passaram.`);
process.exit(failed.length ? 1 : 0);

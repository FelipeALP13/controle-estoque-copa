// Teste dos fluxos principais, de ponta a ponta, contra o Portal rodando localmente:
// demanda (criar, aparecer na lista, concluir, mapa de calor, excluir), chamado (abrir, resolver, excluir),
// artigo (criar, buscar, excluir), item da copa (cadastrar, aparecer, excluir) e agenda (criar, listar, excluir).
// Cria um administrador temporário no banco LOCAL (sem senha: só uma sessão de teste) e apaga tudo no fim.
// O chamado vai para um time temporário só com esse usuário (ninguém da equipe é avisado) e nada sai do computador.
//
// Uso (com o Portal rodando em outra janela: npm run dev):
//   npm run test:flows
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.PORTAL_TEST_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error("Este teste mexe no banco local e só roda contra o Portal local (127.0.0.1 ou localhost).");
  process.exit(2);
}

function sql(command) {
  const output = execFileSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", ".wrangler/state", "--json", "--command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output);
}

const MARK = "teste-fluxo";
const TITLE = `${MARK} ${Date.now()}`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const token = randomBytes(32).toString("hex");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const results = [];
let adminId = 0;
let teamId = 0;

function cleanup() {
  sql(`delete from tasks where title like '${MARK}%';`);
  sql(`delete from tickets where title like '${MARK}%';`);
  sql(`delete from kb_articles where title like '${MARK}%';`);
  sql(`delete from items where name like '${MARK}%';`);
  sql(`delete from agenda_events where title like '${MARK}%';`);
  sql(`delete from notifications where member_id in (select id from members where user_id like '${MARK}-%');`);
  sql(`delete from audit_logs where actor_user_id like '${MARK}-%';`);
  sql(`delete from members where user_id like '${MARK}-%';`);
  sql(`delete from teams where name = '${MARK}';`);
}

async function api(method, path, body) {
  const headers = { Origin: BASE, Cookie: `estoque_session=${token}` };
  if (body) headers["Content-Type"] = "application/json";
  const send = () => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  // O servidor local às vezes derruba a conexão logo depois de o teste gravar direto no banco: tenta de novo uma vez.
  const response = await send().catch(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); return send(); });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function check(label, ok, detail = "") {
  results.push({ ok: Boolean(ok), label, detail });
}

try {
  cleanup();
  sql(`insert into members (user_id, name, email, role, permissions, active) values ('${MARK}-admin', 'Teste fluxo', '${MARK}@pendente.local', 'admin', '{}', 1);`);
  adminId = sql(`select id from members where user_id = '${MARK}-admin';`)[0].results[0].id;
  sql(`insert into sessions (member_id, token_hash, expires_at, last_seen_at, device) values (${adminId}, '${sha256(token)}', '${new Date(Date.now() + 3600000).toISOString()}', '${new Date().toISOString()}', 'Teste de fluxos');`);

  // Demanda
  const created = await api("POST", "/api/tasks", { action: "createTask", title: `${TITLE} demanda`, description: "teste", owners: [adminId], support: [], status: "todo", priority: 0 });
  const taskId = created.data.task?.id;
  check("demanda: criar", created.status === 201 && taskId, `status ${created.status}`);
  const list = await api("GET", "/api/tasks");
  check("demanda: aparece na lista", list.data.tasks?.some((task) => task.id === taskId));
  const done = await api("POST", "/api/tasks", { action: "updateTask", taskId, status: "done" });
  check("demanda: concluir", done.status === 200, `status ${done.status}`);
  const stored = sql(`select status, completed_on from tasks where id = ${Number(taskId) || 0};`)[0].results[0];
  check("demanda: gravada como concluída hoje", stored?.status === "done" && stored?.completed_on === today, JSON.stringify(stored));
  const activity = await api("GET", "/api/activity");
  check("mapa de calor: conta a demanda concluída", activity.data.days?.[today]?.tasks >= 1, JSON.stringify(activity.data.days?.[today] ?? null));
  const removedTask = await api("POST", "/api/tasks", { action: "deleteTask", taskId });
  check("demanda: excluir", removedTask.status === 200, `status ${removedTask.status}`);
  check("demanda: sumiu da lista", !(await api("GET", "/api/tasks")).data.tasks?.some((task) => task.id === taskId));

  // Chamado (time temporário só com o usuário de teste: ninguém da equipe é avisado)
  sql(`insert into teams (name, color) values ('${MARK}', 'blue');`);
  teamId = sql(`select id from teams where name = '${MARK}';`)[0].results[0].id;
  sql(`insert into team_members (team_id, member_id) values (${teamId}, ${adminId});`);
  const ticket = await api("POST", "/api/tickets", { action: "createTicket", title: `${TITLE} chamado`, description: "teste", teamId, type: "question", urgency: "low", client: "" });
  const ticketId = ticket.data.ticket?.id;
  check("chamado: abrir", ticket.status === 201 && ticketId, `status ${ticket.status} ${ticket.data.error ?? ""}`);
  const tickets = await api("GET", "/api/tickets");
  check("chamado: aparece na lista", tickets.data.tickets?.some((entry) => entry.id === ticketId));
  const resolved = await api("POST", "/api/tickets", { action: "updateTicket", ticketId, status: "resolved", assigneeId: adminId });
  check("chamado: resolver", resolved.status === 200 && resolved.data.ticket?.status === "resolved", `status ${resolved.status} ${resolved.data.error ?? ""}`);
  const removedTicket = await api("POST", "/api/tickets", { action: "deleteTicket", ticketId });
  check("chamado: excluir", removedTicket.status === 200, `status ${removedTicket.status}`);

  // Artigo da base de conhecimento
  const article = await api("POST", "/api/knowledge", { action: "saveArticle", title: `${TITLE} artigo`, body: "Passo a passo de teste.", tags: "teste", teamId: null, clientId: null });
  check("artigo: criar", article.status === 200 || article.status === 201, `status ${article.status} ${article.data.error ?? ""}`);
  const found = await api("GET", `/api/search?q=${encodeURIComponent(MARK)}`);
  check("busca geral: acha o artigo", JSON.stringify(found.data).includes(`${TITLE} artigo`), `status ${found.status}`);
  const articleId = sql(`select id from kb_articles where title = '${TITLE} artigo';`)[0].results[0]?.id;
  const removedArticle = await api("POST", "/api/knowledge", { action: "deleteArticle", articleId });
  check("artigo: excluir", removedArticle.status === 200, `status ${removedArticle.status}`);

  // Item da copa
  const item = await api("POST", "/api/inventory", { action: "addItem", name: `${TITLE} item`, category: "Outros", unit: "unidade", minimumQty: 2, icon: "", scanCode: "" });
  check("copa: cadastrar item", item.status === 200 || item.status === 201, `status ${item.status} ${item.data.error ?? ""}`);
  const inventory = await api("GET", "/api/inventory");
  const itemRow = inventory.data.items?.find((entry) => entry.name === `${TITLE} item`);
  check("copa: item aparece com saldo 0", itemRow && Number(itemRow.unopenedQty ?? 0) + Number(itemRow.openedQty ?? 0) === 0);
  const removedItem = await api("POST", "/api/inventory", { action: "deleteItem", itemId: itemRow?.id });
  check("copa: excluir item", removedItem.status === 200, `status ${removedItem.status}`);

  // Agenda
  const event = await api("POST", "/api/agenda", { action: "saveEvent", kind: "note", title: `${TITLE} agenda`, notes: "", day: today, time: "23:30", endTime: "", teamsUrl: "", remindBefore: null, repeat: "", attendees: [] });
  check("agenda: criar", event.status === 200 || event.status === 201, `status ${event.status} ${event.data.error ?? ""}`);
  const eventId = sql(`select id from agenda_events where title = '${TITLE} agenda';`)[0].results[0]?.id;
  const agenda = await api("GET", "/api/agenda");
  check("agenda: aparece na lista", JSON.stringify(agenda.data).includes(`${TITLE} agenda`));
  const removedEvent = await api("POST", "/api/agenda", { action: "deleteEvent", eventId });
  check("agenda: excluir", removedEvent.status === 200, `status ${removedEvent.status}`);
} finally {
  try { cleanup(); } catch (error) { console.error("Limpeza falhou:", error.message); }
}

for (const result of results) console.log(`${result.ok ? "ok  " : "FALHOU"}  ${result.label}${result.ok ? "" : `  (${result.detail})`}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed} de ${results.length} passaram. Dados de teste apagados.`);
process.exit(failed ? 1 : 0);

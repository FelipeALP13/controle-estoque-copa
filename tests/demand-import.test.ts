import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPerson, mapStatus, mergeDemands, parseHours, parseSheetDate, parseWorkbook, splitPeople, suspiciousHours, type Issue } from "../app/demand-import.ts";

const categories = ["Atendimento", "Bug", "Melhoria", "Desenvolvimento", "Solicitação"];
const header = ["ID", "Data", "Cliente / Projeto", "Demanda / Atividade", "Categoria", "Responsáveis", "Resp. Suporte", "Prioridade", "Status", "", "", "", "", "", "Origem / Ticket", "OBS / Impedimentos"];
const tab = (owner: string, rows: string[][]) => ({ name: owner, rows: [[`MINHAS DEMANDAS | ${owner}`], ["Responsável", owner], header, ...rows] });

test("lê datas da planilha em vários formatos", () => {
  assert.deepEqual(parseSheetDate("04/09/2026"), { ok: true, value: "2026-09-04", empty: false });
  assert.deepEqual(parseSheetDate("4/9/26"), { ok: true, value: "2026-09-04", empty: false });
  assert.deepEqual(parseSheetDate("46265"), { ok: true, value: "2026-08-31", empty: false });
  assert.deepEqual(parseSheetDate("A definir"), { ok: true, value: null, empty: true });
  assert.equal(parseSheetDate("31/02/2026").ok, false);
  assert.equal(parseSheetDate("ontem").ok, false);
});

test("lê horas e status", () => {
  assert.deepEqual(parseHours("8,5"), { ok: true, value: 8.5 });
  assert.deepEqual(parseHours(""), { ok: true, value: null });
  assert.equal(parseHours("-3").ok, false);
  assert.equal(mapStatus("Em Validação"), "in_review");
  assert.equal(mapStatus("aguardando resposta"), "waiting");
  assert.equal(mapStatus("Feito"), null);
});

test("separa responsáveis por vírgula ou ponto e vírgula e aplica apelidos", () => {
  assert.deepEqual(splitPeople("Allex T., Miguel R.; allex t."), ["Allex T.", "Miguel R."]);
  assert.equal(canonicalPerson("Miguel A."), "Miguel R.");
});

test("lê as abas pessoais, valida e completa colunas sem cabeçalho", () => {
  const parsed = parseWorkbook("development", [
    { name: "Base Geral", rows: [["DEMANDAS DIÁRIAS | DESENVOLVIMENTO"]] },
    tab("Angelo S.", [
      ["AS-0001", "01/09/2026", "SGAD", "CNPJ alfanumérico", "Melhoria", "Angelo S.", "José", "Alta", "Concluído", "01/09/2026", "15/09/2026", "15/09/2026", "88", "88", "", "Receita Federal"],
      ["AS-0002", "04/09/2026", "Dr. Online", "Grupo de perguntas", "Categoria nova", "", "", "Baixíssima", "Pausado"],
      ["AS-0003", "31/02/2026", "Dr. Online", "", "Melhoria", "Angelo S.", "", "Baixa", "Pausado"],
      ["AS-0004", "04/09/2026", "Dr. Online", "Mensageria", "Melhoria", "Angelo S.", "", "Baixa", "Feito"],
      ["", "", "", "", "", "", "", "", ""],
    ]),
    { name: "Configurações", rows: [["CONFIGURAÇÕES"], ["Equipe de Suporte", "Equipe de Desenvolvimento"], ["José", "Allex T."], ["Felipe", "Miguel A."], ["Múltiplos responsáveis: informe os nomes oficiais na mesma célula, separados por ponto e vírgula.", "Allex T."]] },
  ], categories);

  assert.deepEqual(parsed.rosters, { support: ["José", "Felipe"], development: ["Allex T.", "Miguel R."] });
  assert.equal(parsed.demands.length, 2);
  const [first, second] = parsed.demands;
  assert.deepEqual([first.code, first.startDate, first.dueDate, first.completedOn, first.estimatedHours, first.workedHours, first.support, first.priority, first.status], ["AS-0001", "2026-09-01", "2026-09-15", "2026-09-15", 88, 88, ["José"], 2, "done"]);
  assert.deepEqual([second.owners, second.priority, second.category], [["Angelo S."], 0, "Categoria nova"]);
  const messages = (level: Issue["level"]) => parsed.issues.filter((issue) => issue.level === level).map((issue) => issue.message);
  assert.deepEqual(messages("error"), ["AS-0003: linha sem \"Demanda / Atividade\".", "AS-0004: status desconhecido \"Feito\"."]);
  assert.ok(messages("warning").some((message) => message.includes("prioridade desconhecida")));
  assert.ok(messages("warning").some((message) => message.includes("categoria fora da lista")));
  assert.ok(messages("warning").some((message) => message.includes("sem responsável")));
});

test("junta a mesma demanda repetida em abas diferentes, mas não na mesma aba", () => {
  const parsed = parseWorkbook("development", [
    tab("Allex T.", [["AT-0002", "04/09/2026", "Dr. Online", "Fluxograma e Organograma", "Desenvolvimento", "Allex T., Miguel R.", "", "Média", "Backlog"]]),
    tab("Miguel R.", [
      ["MR-0001", "04/09/2026", "Dr. Online", "Fluxograma e Organograma", "Desenvolvimento", "Allex T., Miguel R.", "", "Média", "Fazendo"],
      ["MR-0005", "05/09/2026", "Operadora", "Atendimento", "Atendimento", "Miguel R.", "", "", "Concluído"],
      ["MR-0006", "06/09/2026", "Operadora", "Atendimento", "Atendimento", "Miguel R.", "", "", "Concluído"],
    ]),
    tab("Caio V.", [["CV-0009", "04/09/2026", "Dr. Online", "Fluxograma e Organograma", "Desenvolvimento", "Caio V.", "", "Baixa", "A Fazer"]]),
  ], categories);
  const issues: Issue[] = [];
  const merged = mergeDemands(parsed.demands, issues);
  const flow = merged.filter((demand) => demand.title === "Fluxograma e Organograma");
  assert.equal(flow.length, 2);
  assert.deepEqual(flow[0].codes, ["AT-0002", "MR-0001"]);
  assert.deepEqual(flow[0].owners, ["Allex T.", "Miguel R."]);
  assert.equal(flow[0].status, "backlog");
  assert.deepEqual(flow[1].codes, ["CV-0009"]);
  assert.equal(merged.filter((demand) => demand.title === "Atendimento").length, 2);
  assert.ok(issues[0].message.includes("AT-0002 + MR-0001 foram unidas: status diferentes (AT-0002: Backlog, MR-0001: Fazendo) → ficou Backlog, o mais atrasado"));
});

test("junta com cliente diferente só se os responsáveis forem exatamente os mesmos (2 ou mais)", () => {
  const parsed = parseWorkbook("development", [
    tab("Allex T.", [["AT-0002", "04/09/2026", "Dr. Online", "Fluxograma e Organograma", "Desenvolvimento", "Allex T., Miguel R.", "", "Média", "Backlog"]]),
    tab("Miguel R.", [["MR-0001", "04/09/2026", "Todos os Projetos", "Fluxograma e Organograma", "Desenvolvimento", "Miguel R.; Allex T.", "", "Média", "Backlog"]]),
    tab("Yasmin S.", [["YS-0001", "01/09/2026", "SGE", "CNPJ alfanumérico", "Melhoria", "Yasmin S.", "", "Alta", "Concluído"]]),
    tab("Lucas P.", [["LP-0002", "01/09/2026", "Operadora", "CNPJ alfanumérico", "Melhoria", "Lucas P.", "", "Alta", "Concluído"]]),
  ], categories);
  const issues: Issue[] = [];
  const merged = mergeDemands(parsed.demands, issues);
  assert.deepEqual(merged.map((demand) => demand.codes), [["AT-0002", "MR-0001"], ["YS-0001"], ["LP-0002"]]);
  assert.ok(issues.some((issue) => issue.message.includes("clientes diferentes (Dr. Online, Todos os Projetos) → ficou Dr. Online")));
});

test("na junção: status mais atrasado, horas trabalhadas somadas e campos vazios completados", () => {
  // Caso real AS-0021 + MR-0021 e FS-0003 + GAB-0010 das planilhas.
  const parsed = parseWorkbook("development", [
    tab("Angelo S.", [["AS-0021", "07/10/2026", "Operadora", "Exibir valores", "Solicitação", "Angelo S., Miguel R.", "Taís", "Alta", "Em Validação", "07/10/2026", "09/10/2026", "09/10/2026", "24", "24"]]),
    tab("Miguel R.", [["MR-0021", "07/10/2026", "Operadora", "Exibir valores", "Solicitação", "Angelo S., Miguel R.", "", "Alta", "Concluído", "07/10/2026", "09/10/2026", "08/10/2026", "24", "16", "", "Validado pelo suporte"]]),
    tab("Fabricio S.", [["FS-0003", "15/09/2026", "Operadora", "Conexão com ia externa", "Desenvolvimento", "Fabricio S., Gabriel M.", "", "Média", "Fazendo"]]),
    tab("Gabriel M.", [["GAB-0010", "15/09/2026", "Operadora", "Conexão com ia externa", "Desenvolvimento", "Fabricio S., Gabriel M.", "", "Média", "Fazendo", "15/09/2026", "", "", "328", "328"]]),
  ], categories);
  const issues: Issue[] = [];
  const [shared, ia] = mergeDemands(parsed.demands, issues);
  assert.deepEqual([shared.status, shared.workedHours, shared.estimatedHours, shared.notes, shared.support], ["in_review", 40, 24, "Validado pelo suporte", ["Taís"]]);
  assert.ok(issues[0].message.includes("horas trabalhadas somadas (24 + 16 = 40 h)"));
  assert.deepEqual([ia.codes, ia.startDate, ia.estimatedHours, ia.workedHours], [["FS-0003", "GAB-0010"], "2026-09-15", 328, 328]);
});

test("sinaliza horas impossíveis para o período", () => {
  const base = { status: "done" as const, openedOn: "2026-09-01", startDate: "2026-08-31", dueDate: null, completedOn: "2026-09-04", estimatedHours: 40, workedHours: 416 };
  assert.deepEqual(suspiciousHours(base, "2026-11-10"), ["416 h trabalhadas em 5 dias"]);
  // Concluída sem data de conclusão: o prazo fecha o período (caso LP-0001 da planilha).
  assert.deepEqual(suspiciousHours({ ...base, completedOn: null, dueDate: "2026-09-04" }, "2026-11-10"), ["416 h trabalhadas em 5 dias"]);
  // Ainda aberta: o período vai até hoje.
  assert.deepEqual(suspiciousHours({ ...base, status: "in_progress", completedOn: null }, "2026-11-10"), []);
  assert.deepEqual(suspiciousHours({ ...base, startDate: null, completedOn: "2026-09-10", estimatedHours: 1200, workedHours: 80 }, "2026-11-10"), ["1200 h estimadas (acima de 1.000 h)"]);
  assert.deepEqual(suspiciousHours({ ...base, openedOn: null, startDate: null, completedOn: null, estimatedHours: null, workedHours: 50 }, "2026-11-10"), []);
});

test("demanda no Suporte e no Dev: o Dev executa e o Suporte vira Resp. Suporte", () => {
  const supportTab = { name: "Taís", rows: [["MINHAS DEMANDAS | Taís"], ["Responsável", "Taís"], ["ID", "Data", "Cliente / Projeto", "Demanda / Atividade", "Categoria", "Responsáveis", "Prioridade", "Status"], ["TF-0009", "07/10/2026", "Operadora", "Exibir valores", "Solicitação", "Taís; Daniel", "Alta", "Em Validação"]] };
  const support = parseWorkbook("support", [supportTab], categories).demands;
  const dev = parseWorkbook("development", [tab("Angelo S.", [["AS-0022", "07/10/2026", "Operadora", "Exibir valores", "Solicitação", "Angelo S., Miguel R.", "Taís", "Alta", "Concluído", "07/10/2026", "09/10/2026", "09/10/2026", "24", "24"]])], categories).demands;
  const [merged] = mergeDemands([...support, ...dev], []);
  // O Suporte ainda está validando (Em Validação) e o Dev já concluiu: vale o mais atrasado.
  assert.deepEqual([merged.code, merged.status, merged.owners, merged.support, merged.codes], ["AS-0022", "in_review", ["Angelo S.", "Miguel R."], ["Taís", "Daniel"], ["TF-0009", "AS-0022"]]);
});

test("lê os Projetos Grandes da planilha da Liderança", () => {
  const parsed = parseWorkbook("leadership", [{ name: "Projetos Grandes", rows: [
    ["Projeto / Módulo", "Demanda (História de Usuário)", "Descrição / Escopo", "Responsáveis", "Prazo", "Data de Início", "Previsão de Encerramento", "", "Status (Kanban)", "Farol", "Fase do Projeto (PMBOK)", "OBS / Impedimentos / Bloqueios"],
    ["Dr. Online", "Assinatura Salus Sign", "Integrar assinatura", "Vitor B.; L. Miguel", "10 dias", "26/08/2026", "28/08/2026", "2", "A Fazer", "🟡", "Execução / Monitoramento", "Em análise"],
    ["Operadora", "Aplicação mobile", "Versão web mobile", "Fabricio S.", "A definir", "A definir", "A definir", "1", "Fazendo", "🔵", "Pausado", ""],
  ] }], categories);
  assert.equal(parsed.issues.length, 0);
  assert.deepEqual(parsed.projects.map((project) => [project.name, project.people, project.startDate, project.endForecast, project.status, project.farol, project.phase]), [
    ["Assinatura Salus Sign", ["Vitor B.", "L. Miguel"], "2026-08-26", "2026-08-28", "todo", "yellow", "execution"],
    ["Aplicação mobile", ["Fabricio S."], null, "A definir", "in_progress", "blue", "paused"],
  ]);
});

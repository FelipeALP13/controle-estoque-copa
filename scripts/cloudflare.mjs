// Hospedagem própria na Cloudflare (conta da empresa), no plano gratuito (sem cartão).
//
//   node scripts/cloudflare.mjs criar     -> cria o banco D1 e o Workers KV dos arquivos e grava os nomes em cloudflare.config.json
//   node scripts/cloudflare.mjs publicar  -> build, aplica as migrações novas no banco de produção e publica o Worker
//   node scripts/cloudflare.mjs backup    -> baixa uma cópia completa do banco de produção para backups/ (fora do Git)
//
// Com --teste, tudo vale para o ambiente de TESTE (Worker, banco e arquivos próprios, em cloudflare.teste.json):
//   node scripts/cloudflare.mjs criar --teste   e   node scripts/cloudflare.mjs publicar --teste
// Use o ambiente de teste para auditorias e testes que criam dados; a produção fica só com dados reais.
//
// Antes, uma vez: "node node_modules/wrangler/bin/wrangler.js login" (abre o navegador para você entrar na Cloudflare).
// Nenhum segredo fica neste arquivo nem no cloudflare.config.json. A chave de criptografia (ENCRYPTION_KEY) é gerada
// aqui na primeira publicação, enviada direto à Cloudflare e nunca aparece na tela nem fica gravada no computador.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const TESTE = process.argv.includes("--teste");
const CONFIG = path.join(root, TESTE ? "cloudflare.teste.json" : "cloudflare.config.json");
const BUILT = path.join(root, "dist/server/wrangler.json");
const DEPLOY = path.join(root, "dist/server/wrangler.deploy.json");
const WRANGLER = path.join(root, "node_modules/wrangler/bin/wrangler.js");

const defaults = TESTE
  ? { workerName: "portaldaequipe-teste", databaseName: "portal-equipe-teste-db", databaseId: "", filesName: "portal-equipe-teste-arquivos", filesId: "" }
  : { workerName: "portaldaequipe", databaseName: "portal-equipe-db", databaseId: "", filesName: "portal-equipe-arquivos", filesId: "" };
const readConfig = () => ({ ...defaults, ...(existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {}) });
const saveConfig = (config) => {
  const rest = { ...config };
  delete rest.bucketName; // nome antigo (R2), não é mais usado
  writeFileSync(CONFIG, JSON.stringify(rest, null, 2) + "\n");
};

function run(args, { capture = false, allowFail = false } = {}) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: root, stdio: capture ? ["inherit", "pipe", allowFail ? "pipe" : "inherit"] : "inherit", encoding: "utf8" });
  if (capture && result.stdout && !allowFail) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    if (allowFail) return null;
    // Lança em vez de sair na hora, para os "finally" (ex.: apagar o arquivo da chave) rodarem.
    throw new Error(`Falhou: wrangler ${args[0]} ${args[1] ?? ""}`.trim());
  }
  return result.stdout ?? "";
}

function criar() {
  const config = readConfig();
  if (!config.databaseId) {
    const out = run(["d1", "create", config.databaseName, "--location", "enam"], { capture: true });
    const id = out.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i)?.[1] ?? out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)?.[1];
    if (!id) {
      console.error("Não encontrei o identificador do banco na resposta. Copie o database_id acima para cloudflare.config.json.");
      process.exit(1);
    }
    config.databaseId = id;
    saveConfig(config);
    console.log(`\nBanco criado e anotado em ${path.basename(CONFIG)}.`);
  } else console.log(`O banco já existe (${path.basename(CONFIG)}).`);
  if (!config.filesId) {
    const out = run(["kv", "namespace", "create", config.filesName], { capture: true });
    const id = out.match(/"id"\s*:\s*"([0-9a-f]{32})"/i)?.[1] ?? out.match(/id\s*=\s*"([0-9a-f]{32})"/i)?.[1];
    if (!id) {
      console.error("Não encontrei o identificador do armazenamento na resposta. Copie o id acima para filesId em cloudflare.config.json.");
      process.exit(1);
    }
    config.filesId = id;
    saveConfig(config);
    console.log(`\nArmazenamento de arquivos (Workers KV) criado e anotado em ${path.basename(CONFIG)}.`);
  } else console.log("O armazenamento de arquivos já existe.");
  console.log(`\nPróximo passo: node scripts/cloudflare.mjs publicar${TESTE ? " --teste" : ""}`);
}

function deployConfig() {
  const config = readConfig();
  if (!config.databaseId || !config.filesId) {
    console.error(`Rode antes "node scripts/cloudflare.mjs criar${TESTE ? " --teste" : ""}".`);
    process.exit(1);
  }
  const built = JSON.parse(readFileSync(BUILT, "utf8"));
  const deploy = {
    ...built,
    name: config.workerName,
    topLevelName: config.workerName,
    d1_databases: [{ binding: "DB", database_name: config.databaseName, database_id: config.databaseId, migrations_dir: "../../drizzle" }],
    r2_buckets: [],
    kv_namespaces: [{ binding: "FILES", id: config.filesId }],
    workers_dev: true,
    // Um endereço só: sem links extras de prévia por versão.
    preview_urls: false,
    // Smart Placement: o Portal roda perto do banco (cada tela faz várias consultas seguidas),
    // em vez de atravessar o continente a cada consulta. Incluído no plano gratuito.
    placement: { mode: "smart" },
  };
  if (config.customDomain) deploy.routes = [{ pattern: config.customDomain, custom_domain: true }];
  writeFileSync(DEPLOY, JSON.stringify(deploy));
  return config;
}

/** A chave de criptografia já existe no Worker? (Nunca é trocada: trocar deixaria os tokens guardados ilegíveis.) */
function hasEncryptionKey(workerName) {
  const out = run(["secret", "list", "--name", workerName, "--format", "json"], { capture: true, allowFail: true });
  if (out === null) return false; // o Worker ainda não existe
  try { return JSON.parse(out).some((secret) => secret.name === "ENCRYPTION_KEY"); } catch { return false; }
}

function publicar() {
  const build = spawnSync(process.execPath, [path.join(root, "scripts/run-framework.mjs"), "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const config = deployConfig();
  console.log(`\nAplicando as migrações novas no banco ${TESTE ? "de TESTE" : "de produção"}...`);
  run(["d1", "migrations", "apply", "DB", "--remote", "--config", DEPLOY]);
  console.log("\nPublicando...");
  if (hasEncryptionKey(config.workerName)) run(["deploy", "--config", DEPLOY]);
  else {
    // Primeira publicação: a chave vai junto, num arquivo temporário fora do projeto, apagado logo depois.
    const dir = mkdtempSync(path.join(os.tmpdir(), "portal-chave-"));
    const file = path.join(dir, "secrets.json");
    try {
      writeFileSync(file, JSON.stringify({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }), { mode: 0o600 });
      run(["deploy", "--config", DEPLOY, "--secrets-file", file]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    console.log("\nChave de criptografia criada e guardada como segredo do Worker.");
  }
  console.log(`\nPublicado. Se ainda não criou o primeiro administrador, defina o código de instalação (24+ caracteres) com\n  node node_modules/wrangler/bin/wrangler.js secret put SETUP_TOKEN --name ${config.workerName}\nabra o endereço acima e use esse código na tela "Criar administrador". Depois, apague o código com\n  node node_modules/wrangler/bin/wrangler.js secret delete SETUP_TOKEN --name ${config.workerName}`);
}

function backup() {
  const config = deployConfig();
  const dir = path.join(root, "backups");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${config.databaseName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.sql`);
  run(["d1", "export", "DB", "--remote", "--config", DEPLOY, "--output", file]);
  console.log(`\nBackup salvo em ${file} (fica só no seu computador; a pasta backups/ não vai para o Git).`);
}

const command = process.argv[2];
const actions = { criar, publicar, backup };
if (!actions[command]) {
  console.log("Use: node scripts/cloudflare.mjs criar | publicar | backup");
  process.exit(command ? 1 : 0);
}
try {
  actions[command]();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

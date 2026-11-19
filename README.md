# Portal da Equipe

Sistema interno da equipe (Suporte, Desenvolvimento e Liderança): demandas, chamados entre os times, agenda, escala de atendimento, projetos, base de conhecimento, estoque da copa e diretório de pessoas.

Roda como um Cloudflare Worker na **conta Cloudflare da empresa**, com banco D1 (SQLite) e arquivos no KV (plano gratuito, sem cartão). Cada pessoa entra com o próprio usuário e senha.

## Hospedagem própria (Cloudflare)

Tudo pelo `scripts/cloudflare.mjs`. Os nomes do banco e do armazenamento ficam em `cloudflare.config.json` (sem segredos). Opcional: `"customDomain": "portal.suaempresa.com.br"`, para um domínio que já esteja na mesma conta Cloudflare.

1. Uma vez: `node node_modules/wrangler/bin/wrangler.js login` (abre o navegador para entrar na Cloudflare).
2. Uma vez: `node scripts/cloudflare.mjs criar` (cria o banco D1 e o armazenamento de arquivos no KV).
3. A cada versão nova: `node scripts/cloudflare.mjs publicar` (build, migrações novas no banco de produção, publicação).
4. Primeiro acesso: defina um código de instalação com `wrangler secret put SETUP_TOKEN --name portaldaequipe` (24+ caracteres). Sem ele, ninguém consegue criar o administrador. Depois de criar, apague com `wrangler secret delete SETUP_TOKEN --name portaldaequipe`.
5. Backup completo: `node scripts/cloudflare.mjs backup` (arquivo `.sql` em `backups/`, que não vai para o Git). No painel da Cloudflare (D1 → Time Travel) dá para voltar o banco a qualquer momento dos últimos 7 dias (plano gratuito) ou 30 dias (plano pago), e o Console roda SQL direto.

### Ambiente de teste

Uma segunda cópia do Portal, com banco e arquivos próprios, para auditorias e testes que criam dados (a produção fica só com dados reais): **https://portaldaequipe-teste.grupohermanos.workers.dev**. Os nomes ficam em `cloudflare.teste.json`.

- Publicar a versão atual no teste: `node scripts/cloudflare.mjs publicar --teste`.
- Primeiro acesso: igual ao passo 4, com `--name portaldaequipe-teste` (código de instalação próprio; apague depois).
- Os mesmos comandos aceitam `--teste` (`criar`, `publicar`, `backup`).

## O que tem

| Área | Onde fica |
| --- | --- |
| Visão geral (resumo do dia, mural, minha agenda de hoje) | `app/hub-view.tsx` |
| Minha agenda (anotações e reuniões no Teams ou no Google Meet, lembretes, repetição, link para o Outlook) | `app/agenda-view.tsx`, `app/agenda.ts`, `app/ics.ts`, `app/api/agenda/` |
| Meu dia (resumo ao abrir o Portal) | `app/my-day.tsx` |
| Calendário (prazos, ausências, escala, projetos, agenda) | `app/calendar-view.tsx`, `app/calendar.ts` |
| Demandas (quadro, lista, checklist, horas, cronômetro, dependências, modelos, repetição) | `app/tasks-view.tsx`, `app/task-drawer.tsx`, `app/task-shared.tsx`, `app/task-recurrence*.ts`, `app/task-timer.tsx`, `app/api/tasks/` |
| Chamados (lista e quadro, SLA, Jira, respostas prontas, avaliação) | `app/tickets-view.tsx`, `app/jira*.ts`, `app/ticket-routing.ts`, `app/ticket-rating*.ts(x)`, `app/api/tickets/` |
| Anexos de demandas e chamados | `app/attachments*.ts(x)`, `app/api/attachments/` |
| Projetos (lista e linha do tempo) | `app/projects-view.tsx`, `app/project-timeline.ts`, `app/api/projects/` |
| Clientes: ficha, acessos aos sistemas (senha criptografada), monitor no ar e relatório mensal | `app/clients-view.tsx`, `app/system-monitor.ts`, `app/api/clients/` |
| Sprints (capacidade, gráfico de queima) e retrospectivas | `app/sprints-view.tsx`, `app/api/sprints/`, `app/api/retros/` |
| Avaliação trimestral (anônima, com justificativa por critério) e metas anuais do time e individuais | `app/reviews-view.tsx`, `app/review-tools.ts`, `app/api/reviews/`, `app/api/goals/` |
| 1:1 entre líder e liderado e plano de desenvolvimento ligado às médias da avaliação | `app/one-on-ones-view.tsx`, `app/team-scope.ts`, `app/api/one-on-ones/` |
| Chat da equipe: canais e conversa com uma pessoa, fotos e GIFs (anexar, colar, arrastar e busca pelo Giphy), formatação, emojis e "digitando…"; painel lateral para responder de qualquer tela (posts com fotos, enquetes, reações e comentários; posts automáticos de aniversário, tempo de casa, boas-vindas e meta batida) | `app/community-view.tsx`, `app/chat-thread.tsx`, `app/chat-panel.tsx`, `app/social-tools.ts`, `app/chat-unread.ts`, `app/api/chat/`, `app/api/gifs/` |
| Pesquisa de clima mensal (anônima) | `app/pulse-view.tsx`, `app/pulse-store.ts`, `app/api/pulse/` |
| Equipamentos e licenças (com quem está, vencimentos) | `app/assets-view.tsx` (aba em Pessoas), `app/api/assets/` |
| Incidentes (abertos e resolvidos pelo monitor, análise de causa) | `app/clients-area.tsx` (aba em Clientes), `app/incidents-view.tsx`, `app/api/incidents/`, `app/system-monitor.ts` |
| Integração de quem chega | `app/onboarding-view.tsx`, `app/api/onboarding/` |
| Base de conhecimento e mural | `app/knowledge-view.tsx`, `app/notice-board.tsx` |
| Escala de atendimento e passagem de plantão | `app/schedule-view.tsx`, `app/support-schedule.ts`, `app/handoff-panel.tsx`, `app/api/handoffs/` |
| Aniversários e tempo de casa | `app/celebrations-card.tsx`, aviso em `app/jobs.ts` |
| Regras dos recursos acima (puras, testadas) | `app/team-tools.ts`, `app/office-tools.ts` |
| Pessoas, times e ausências | `app/people-view.tsx`, `app/absences*.ts(x)` |
| Painel da liderança, relatório do mês e qualidade | `app/leadership-*.tsx`, `app/monthly-report*.ts(x)`, `app/support-quality*.ts(x)` |
| Modo escuro | `app/theme*.ts(x)`, `app/dark-theme.css` (gerado) |
| Estoque da copa (saldos, lista de compras automática, previsão de consumo) | `app/stock-views.tsx`, `app/stock-forecast.ts`, `app/shopping-list.tsx`, `app/api/inventory/` |
| Copa: modo "fazer compras" (marca no mercado e registra tudo de uma vez), aviso de estoque baixo (sino e canal do chat) e pedidos da equipe com apoio | `app/shopping-trip.tsx`, `app/copa-requests-view.tsx`, `app/copa-tools.ts`, `app/copa-alerts.ts`, `app/api/copa/` |
| Usuários, permissões, histórico e cópia de segurança | `app/team-view.tsx`, `app/admin-view.tsx`, `app/api/admin/` |
| Sino de avisos (som, aviso na tela e no sistema) | `app/notifications-bell.tsx`, `app/notify-sound.ts` |
| Login e sessões (renovação, 7 dias sem uso, encerrar aparelhos) | `app/auth-session.ts`, `app/session-policy.ts`, `app/sessions-panel.tsx` |
| Instalar como app (PWA; com logo enviado, os ícones de instalar são gerados dele) | `app/api/manifest/`, `app/app-icons.ts`, `public/sw.js`, `app/pwa-register.tsx` |

A tela principal (`app/dashboard-client.tsx`) monta o menu e troca entre essas áreas. Tipos e utilidades comuns ficam em `app/dashboard-shared.tsx`.

## Rodar no computador

Requisito: Node.js 22.13 ou mais novo.

```bash
npm run install:ci   # instala as dependências (uma vez)
npm run dev          # abre em http://127.0.0.1:5173
```

O banco local fica em `.wrangler/state` (ignorado pelo Git). Para criar as tabelas, rode o build uma vez e aplique as migrações em ordem (veja abaixo).

## Verificar antes de enviar

```bash
npm run typecheck          # tipos (TypeScript)
npm run lint               # padrões de código
npm test                   # testes das regras (rodam sem servidor)
npm run build              # gera o pacote para publicar
npm run test:a11y          # acessibilidade no código: rótulos de campos, botões só com ícone e imagens sem alt
npm run test:permissions   # permissões das APIs (precisa do npm run dev rodando)
npm run test:flows         # fluxos completos: demanda, chamado, artigo, copa e agenda (precisa do npm run dev rodando)
```

O GitHub roda typecheck, lint, testes, acessibilidade e build a cada envio (`.github/workflows/ci.yml`). Os testes de permissões e de fluxos criam usuários (e um time) temporários **só no banco local**, sem senha, e apagam tudo no final; nenhum aviso sai do computador.

## Banco de dados e migrações

- O esquema fica em `db/schema.ts`. As migrações ficam em `drizzle/` (`0000` a `0039`), com o registro em `drizzle/meta/_journal.json`.
- **No site publicado, `node scripts/cloudflare.mjs publicar` aplica as migrações novas a cada publicação.**
- No computador, aplique cada migração nova uma vez:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0039_hardening.sql
```

## Segurança

- Senhas guardadas como PBKDF2 (210 mil iterações); sessões guardadas só como hash do token.
- Sessão renova enquanto está em uso, cai após 7 dias parada e dura no máximo 90 dias.
- Tokens do Jira ficam criptografados (AES-GCM); a chave (ENCRYPTION_KEY) fica como segredo do Worker, fora do banco.
- Toda API confere login, perfil e a origem do pedido. O corpo dos pedidos passa por `app/api-input.ts` (objeto JSON, tamanho máximo, ação válida).
- A cópia de segurança em Excel não leva senhas, sessões nem chaves (nem as senhas dos sistemas dos clientes).
- Avaliação anônima: as respostas ficam sem ligação com quem respondeu; quem já avaliou quem fica numa tabela à parte (fora da cópia de segurança). Médias só com 3 ou mais respostas e só depois de encerrar o ciclo.
- Pesquisa de clima: mesma regra (respostas sem quem respondeu, quem já respondeu fora da cópia de segurança, resultado só do mês encerrado e com 3 ou mais respostas). Todos veem as médias; comentários só administradores.
- Conversas: mensagens diretas só aparecem para as duas pessoas (nem administradores leem). Administradores podem apagar mensagens de canais (moderação). As conversas ficam fora da cópia de segurança. A busca de GIFs usa o Giphy: a chave (gratuita, criada em developers.giphy.com) é colada por um administrador no botão GIF e fica criptografada; o termo buscado vai para o Giphy.
- 1:1: a nota privada só aparece para o líder que escreveu (nem administradores veem, e fica fora da cópia de segurança). O líder vê as médias da avaliação de quem lidera, sem os comentários.
- Senhas dos sistemas dos clientes: criptografadas com a mesma chave do Jira; só o time dono do acesso e administradores veem, e cada visualização ou cópia fica no histórico.
- Planilhas com dados de clientes (`*.xlsx` na pasta de cima) **nunca** vão para o Git.

## Modo escuro

`app/dark-theme.css` é gerado a partir de `app/globals.css`. Depois de mudar cores no `globals.css`, rode:

```bash
node scripts/build-dark-theme.mjs
```

## Observações

- As rotinas automáticas (busca no Jira, aviso de chamados atrasados, lembretes da agenda, demandas que se repetem, aniversários e tempo de casa, monitor dos sistemas e incidentes automáticos, lembretes da avaliação, lembrete do 1:1 no dia, pesquisa de clima do mês e vencimento de licenças) rodam enquanto alguém da equipe está com o Portal aberto.
- Chamados novos caem na fila do time escolhido, sem responsável: quem atende clica em "Assumir". A escala do Suporte (desenvolvedores que apoiam o Suporte em questões de código) não recebe chamados automaticamente; os nomes da escala são ligados às pessoas do Portal pelo nome só para a passagem de plantão.
- O link da agenda para o Outlook é pessoal e secreto; o banco guarda só o resumo (hash). Desligar ou gerar outro link na Agenda invalida o anterior.

## Sistema visual (tokens)

As cores, raios, sombras e tamanhos ficam num lugar só: o bloco `:root` no início de `app/globals.css`.

- **Marca:** `--brand`, `--brand-hover`, `--brand-text`, `--brand-soft`, `--brand-softer`, `--brand-muted`, `--brand-border`, `--on-brand`, e para o menu lateral e o login (escuros nos dois temas) `--brand-ink`, `--brand-on-dark`, `--brand-deep`.

### White label (Marca e segurança → Marca do Portal)

O administrador muda o nome, o nome curto, a frase, o logo e a cor sem publicar de novo. Fica em `app_settings` (`brand`); o logo, no armazenamento de arquivos (`media/brand/...`).

- `app/brand-theme.ts`: regras puras. A partir de uma cor gera todos os tokens `--brand-*` (claro e escuro, com contraste mínimo garantido). Com a cor padrão não injeta nada, e o visual fica idêntico ao original.
- `app/layout.tsx`: carrega a marca no servidor e injeta `<style id="brand-theme">` antes de desenhar (sem piscar), além do título, do ícone da aba e da cor da barra do celular.
- `app/brand-context.tsx`: `useBrand()` nas telas e `BrandLogo`. Ao salvar, tudo muda na hora, para quem está com o Portal aberto.
- `app/api/brand`: leitura pública (o login precisa dela; só serve o logo configurado) e alteração só por administradores, com registro no histórico. O manifesto do app sai de `/api/manifest`.
- Os ícones de instalação no celular (`public/icon-*.png`) continuam os padrões.
- **Textos:** `--text`, `--text-secondary`, `--text-tertiary`, `--text-muted`, `--text-faint`, `--text-placeholder`.
- **Superfícies e bordas:** `--surface`, `--surface-alt`, `--surface-sunken`, `--canvas`, `--border`, `--border-subtle`, `--border-strong`.
- **Estados:** `--success-*`, `--warning-*`, `--danger-*`, `--purple-*` (variações `-solid`, `-text`, `-soft`...).
- **Formas:** `--radius-sm`, `--radius`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-pill`, `--shadow-sm/md/lg`, `--focus-ring`, `--control-h`.

Regras:

1. Em CSS novo, use os tokens (`var(--text-muted)`), não cores fixas.
2. O tema escuro é gerado: depois de mexer em cores, rode `node scripts/build-dark-theme.mjs`. Tokens cujo nome tem `text` (ou começa com `--on-`) clareiam como texto; os demais escurecem como fundo.
3. Os componentes base (botões, campos, cartões, janelas, alertas) estão no fim de `globals.css`, na seção "Sistema visual: componentes base".
# Portal da Equipe

Sistema interno da equipe (Suporte, Desenvolvimento e Liderança): demandas, chamados entre os times, agenda, escala de atendimento, projetos, base de conhecimento, estoque da copa e diretório de pessoas.

Roda como um Cloudflare Worker publicado pelo **Sites**, com banco D1 (SQLite) e armazenamento R2. Cada pessoa entra com o próprio usuário e senha.

## O que tem

| Área | Onde fica |
| --- | --- |
| Visão geral (resumo do dia, mural, minha agenda de hoje) | `app/hub-view.tsx` |
| Minha agenda (anotações e reuniões no Teams, lembretes, repetição, link para o Outlook) | `app/agenda-view.tsx`, `app/agenda.ts`, `app/ics.ts`, `app/api/agenda/` |
| Meu dia (resumo ao abrir o Portal) | `app/my-day.tsx` |
| Calendário (prazos, ausências, escala, projetos, agenda) | `app/calendar-view.tsx`, `app/calendar.ts` |
| Demandas (quadro, lista, checklist, horas, cronômetro, dependências, modelos, repetição) | `app/tasks-view.tsx`, `app/task-drawer.tsx`, `app/task-shared.tsx`, `app/task-recurrence*.ts`, `app/task-timer.tsx`, `app/api/tasks/` |
| Chamados (lista e quadro, SLA, Jira, atribuição pela escala, respostas prontas, avaliação) | `app/tickets-view.tsx`, `app/jira*.ts`, `app/ticket-assign.ts`, `app/ticket-routing.ts`, `app/ticket-rating*.ts(x)`, `app/api/tickets/` |
| Anexos de demandas e chamados | `app/attachments*.ts(x)`, `app/api/attachments/` |
| Projetos (lista e linha do tempo) | `app/projects-view.tsx`, `app/project-timeline.ts`, `app/api/projects/` |
| Clientes: ficha, acessos aos sistemas (senha criptografada), monitor no ar e relatório mensal | `app/clients-view.tsx`, `app/system-monitor.ts`, `app/api/clients/` |
| Sprints (capacidade, gráfico de queima) e retrospectivas | `app/sprints-view.tsx`, `app/api/sprints/`, `app/api/retros/` |
| Integração de quem chega | `app/onboarding-view.tsx`, `app/api/onboarding/` |
| Base de conhecimento e mural | `app/knowledge-view.tsx`, `app/notice-board.tsx` |
| Escala de atendimento e passagem de plantão | `app/schedule-view.tsx`, `app/support-schedule.ts`, `app/handoff-panel.tsx`, `app/api/handoffs/` |
| Tela para TV (fila em tela cheia, atualiza sozinha) | `app/tv/`, `app/tv-board.tsx`, `app/api/tv/` |
| Aniversários e tempo de casa | `app/celebrations-card.tsx`, aviso em `app/jobs.ts` |
| Regras dos recursos acima (puras, testadas) | `app/team-tools.ts`, `app/office-tools.ts` |
| Pessoas, times e ausências | `app/people-view.tsx`, `app/absences*.ts(x)` |
| Painel da liderança, relatório do mês e qualidade | `app/leadership-*.tsx`, `app/monthly-report*.ts(x)`, `app/support-quality*.ts(x)` |
| Modo escuro | `app/theme*.ts(x)`, `app/dark-theme.css` (gerado) |
| Estoque da copa (saldos, lista de compras automática, previsão de consumo) | `app/stock-views.tsx`, `app/stock-forecast.ts`, `app/shopping-list.tsx`, `app/api/inventory/` |
| Usuários, permissões, histórico e cópia de segurança | `app/team-view.tsx`, `app/admin-view.tsx`, `app/api/admin/` |
| Sino de avisos (som, aviso na tela e no sistema) | `app/notifications-bell.tsx`, `app/notify-sound.ts` |
| Login e sessões (renovação, 7 dias sem uso, encerrar aparelhos) | `app/auth-session.ts`, `app/session-policy.ts`, `app/sessions-panel.tsx` |
| Instalar como app (PWA) | `public/manifest.webmanifest`, `public/sw.js`, `app/pwa-register.tsx` |

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
npm run test:permissions   # permissões das APIs (precisa do npm run dev rodando)
```

O GitHub roda typecheck, lint, testes e build a cada envio (`.github/workflows/ci.yml`). O teste de permissões cria dois usuários temporários **só no banco local**, confere que "Somente leitura" e "Membro" não fazem o que não podem, e apaga tudo no final.

## Banco de dados e migrações

- O esquema fica em `db/schema.ts`. As migrações ficam em `drizzle/` (`0000` a `0027`), com o registro em `drizzle/meta/_journal.json`.
- **No site publicado, o Sites aplica as migrações novas a cada publicação.**
- No computador, aplique cada migração nova uma vez:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0027_office_tools.sql
```

## Segurança

- Senhas guardadas como PBKDF2 (210 mil iterações); sessões guardadas só como hash do token.
- Sessão renova enquanto está em uso, cai após 7 dias parada e dura no máximo 90 dias.
- Tokens do Jira ficam criptografados (AES-GCM); a chave fica no R2, fora do banco.
- Toda API confere login, perfil e a origem do pedido. O corpo dos pedidos passa por `app/api-input.ts` (objeto JSON, tamanho máximo, ação válida).
- A cópia de segurança em Excel não leva senhas, sessões nem chaves (nem as senhas dos sistemas dos clientes).
- Senhas dos sistemas dos clientes: criptografadas com a mesma chave do Jira; só o time dono do acesso e administradores veem, e cada visualização ou cópia fica no histórico.
- Planilhas com dados de clientes (`*.xlsx` na pasta de cima) **nunca** vão para o Git.

## Modo escuro

`app/dark-theme.css` é gerado a partir de `app/globals.css`. Depois de mudar cores no `globals.css`, rode:

```bash
node scripts/build-dark-theme.mjs
```

## Observações

- O nome do pacote (`site-creator-vinext-starter` no `package.json`) é usado como nome do Worker na hospedagem. Ele não foi trocado de propósito, para não mudar a identidade do site publicado.
- As rotinas automáticas (busca no Jira, aviso de chamados atrasados, lembretes da agenda, demandas que se repetem, aniversários e tempo de casa, monitor dos sistemas) rodam enquanto alguém da equipe está com o Portal aberto.
- Chamados novos do time "Suporte" vão sozinhos para quem está na escala da semana (quem tem menos chamados abertos; ausentes ficam de fora). Os nomes da escala são ligados às pessoas do Portal pelo nome; nomes ambíguos são ignorados.
- O link da agenda para o Outlook é pessoal e secreto; o banco guarda só o resumo (hash). Desligar ou gerar outro link na Agenda invalida o anterior.
- Detalhes técnicos do ambiente Sites (perfis de execução, pré-visualização, publicação) estão em `docs/ambiente-sites.md`.

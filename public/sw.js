// Service worker do Portal: só o necessário para instalar como app e mostrar avisos.
// Não guarda dados da equipe no aparelho: tudo continua vindo do servidor a cada acesso.
const OFFLINE_PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portal da Equipe</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f4f6fb;color:#172033}div{max-width:340px;padding:24px;text-align:center}h1{font-size:18px}p{color:#667085;font-size:14px;line-height:1.5}button{margin-top:8px;padding:10px 16px;border:0;border-radius:10px;background:#2f6fed;color:#fff;font-weight:700;cursor:pointer}</style></head>
<body><div><h1>Sem conexão</h1><p>O Portal precisa de internet para mostrar as informações da equipe. Confira a conexão e tente de novo.</p><button onclick="location.reload()">Tentar de novo</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Só as aberturas de página passam por aqui; sem internet, mostra o aviso em vez da tela de erro do navegador.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

// Clique no aviso do sistema: volta para o Portal aberto (ou abre um).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) return open.focus();
    return self.clients.openWindow("/painel");
  })());
});

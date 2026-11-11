import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const https = new URL(request.url).protocol === "https:";
    return Promise.resolve(runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx))).then((response) => withSecurityHeaders(response, https));
  },
};

/** Cabeçalhos de segurança em todas as respostas (sem mexer em respostas de troca de protocolo). */
function withSecurityHeaders(response: Response, https: boolean) {
  if (response.status === 101 || response.webSocket) return response;
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // A câmera fica liberada só para o próprio Portal (leitor de código do estoque).
  secured.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  if (https) secured.headers.set("Strict-Transport-Security", "max-age=31536000");
  return secured;
}

export default worker;

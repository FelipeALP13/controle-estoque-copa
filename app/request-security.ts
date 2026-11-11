/**
 * Pedido que altera dados só vale se vier do próprio Portal.
 * Confere o cabeçalho Origin; sem ele, usa o Sec-Fetch-Site dos navegadores modernos.
 */
export function hasTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

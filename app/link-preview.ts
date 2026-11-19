// Prévia de links do chat (regras puras, testáveis): achar o link, conferir se é seguro buscar e ler título/descrição/imagem.
// Sem imports de outros arquivos do app em tempo de execução (os testes rodam direto no Node).

export type LinkPreview = { url: string; title: string; description: string; siteName: string; image: string | null };

/** Primeiro link http(s) do texto, fora de blocos e trechos de código. */
export function firstLink(text: string) {
  const clean = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
  const match = clean.match(/https?:\/\/[^\s<>()"'`]+/i);
  if (!match) return null;
  const url = match[0].replace(/[.,;:!?\]*_~]+$/, "");
  return isSafePublicUrl(url) ? url : null;
}

/** Só endereços públicos, http(s), porta padrão e sem usuário/senha (nada de rede interna). */
export function isSafePublicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal|lan|home|corp|test|invalid)$/.test(host)) return false;
  if (host.startsWith("[") || host.includes(":")) return false; // IPv6 literal
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
// Acentos nomeados (&oacute;, &atilde;, &ccedil;...): letra + acento combinado.
const MARKS: Record<string, string> = { acute: "́", grave: "̀", circ: "̂", tilde: "̃", uml: "̈", cedil: "̧" };
function decode(text: string) {
  return text
    .replace(/&([a-z])(acute|grave|circ|tilde|uml|cedil);/gi, (_, letter: string, mark: string) => (letter + MARKS[mark.toLowerCase()]).normalize("NFC"))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
}

/** Lê og:/twitter:/<title>/description do HTML. Sem título, não há prévia (null). */
export function parsePreview(html: string, pageUrl: string): LinkPreview | null {
  const head = html.slice(0, 300000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    const content = attr(tag, "content");
    if (key && content && !meta.has(key)) meta.set(key, decode(content));
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = meta.get("og:title") || meta.get("twitter:title") || (titleTag ? decode(titleTag[1]) : "");
  if (!title) return null;
  const description = meta.get("og:description") || meta.get("twitter:description") || meta.get("description") || "";
  let host = "";
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { /* fica sem */ }
  let image: string | null = null;
  const rawImage = meta.get("og:image") || meta.get("og:image:url") || meta.get("twitter:image") || "";
  if (rawImage) {
    try {
      const absolute = new URL(rawImage, pageUrl).toString();
      if (isSafePublicUrl(absolute)) image = absolute;
    } catch { /* imagem inválida: sem imagem */ }
  }
  return { url: pageUrl, title: title.slice(0, 160), description: description.slice(0, 300), siteName: (meta.get("og:site_name") || host).slice(0, 80), image };
}

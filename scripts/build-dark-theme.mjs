// Gera app/dark-theme.css a partir de app/globals.css: cada regra com cor ganha uma versão escura,
// válida só com <html data-theme="dark">. Fundos claros ficam escuros, textos escuros ficam claros
// e cores de destaque (azul, verde, vermelho...) mantêm o tom. O menu lateral já é escuro e fica igual.
//
// Rode depois de mexer nas cores do globals.css:  node scripts/build-dark-theme.mjs
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)|border(-(top|right|bottom|left))?-color|outline|outline-color|box-shadow|fill|stroke|accent-color|caret-color|text-decoration-color|--[\w-]+)$/;
const PREFIX = ':where(html[data-theme="dark"])';

function hexToRgb(hex) {
  let value = hex.slice(1);
  if (value.length === 3 || value.length === 4) value = value.split("").map((char) => char + char).join("");
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255).concat(value.length === 8 ? [parseInt(value.slice(6, 8), 16) / 255] : []);
}
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToHex([h, s, l]) {
  const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return "#" + [f(0), f(8), f(4)].map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0")).join("");
}

/** Clara vira escura e vice-versa; cores médias (destaques) ficam quase iguais. */
function darkColor(hex, prop) {
  const rgba = hexToRgb(hex);
  const alpha = rgba[3];
  const [h, s, l] = rgbToHsl(rgba.slice(0, 3));
  // Texto claro (branco nos botões coloridos, títulos em faixas escuras) continua claro.
  if (prop === "color" && l >= 0.8) return hex;
  let next;
  if (l >= 0.8) {
    // Fundos e bordas claros → superfícies escuras azuladas; quanto mais escuro o original, mais claro o resultado
    // (cartão branco < fundo de destaque < borda), para manter a hierarquia.
    const neutral = s < 0.15;
    next = [neutral ? 0.6 : h, neutral ? 0.22 : Math.min(s, 0.45), 0.13 + (1 - l) * 1.1];
  } else if (l <= 0.3) next = [h, Math.min(s, 0.3), 0.92 - l * 0.4]; // textos escuros → textos claros
  else if (s < 0.3 && prop === "color") next = [h, s, Math.max(0.5, Math.min(0.82, 1.1 - l * 0.9))]; // cinzas de texto
  else next = [h, s, prop === "color" && l < 0.6 ? Math.min(0.75, l + 0.22) : l]; // destaques: texto colorido um pouco mais claro
  const out = hslToHex(next);
  return alpha === undefined ? out : out + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

function convertValue(value, prop) {
  // Branco (ou quase) semitransparente em fundos e bordas, como no cabeçalho com efeito de vidro.
  if (prop !== "color") value = value.replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)/g, (match, r, g, b, alpha) => (Number(r) >= 225 && Number(g) >= 225 && Number(b) >= 225 ? `rgba(19, 27, 40, ${alpha ?? 1})` : match));
  return value
    .replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => ([4, 5, 7, 9].includes(hex.length) ? darkColor(hex, prop) : hex))
    .replace(/(^|[\s,(])(white|#fff)(?=$|[\s,;)!])/gi, (_, before) => before + darkColor("#ffffff", prop));
}

// Parser simples: regras, @media/@supports (um nível) e blocos ignorados (@keyframes, @font-face...).
function parse(css) {
  const out = [];
  let index = 0;
  const skipSpace = () => { while (index < css.length) { if (/\s/.test(css[index])) index += 1; else if (css.startsWith("/*", index)) index = css.indexOf("*/", index) + 2; else break; } };
  const block = () => { // conteúdo entre { } com profundidade
    let depth = 1; const start = index;
    while (depth && index < css.length) { const char = css[index]; if (css.startsWith("/*", index)) { index = css.indexOf("*/", index) + 2; continue; } if (char === "{") depth += 1; if (char === "}") depth -= 1; index += 1; }
    return css.slice(start, index - 1);
  };
  while (index < css.length) {
    skipSpace();
    if (index >= css.length) break;
    if (css[index] === "@") {
      const semi = css.indexOf(";", index), brace = css.indexOf("{", index);
      if (semi !== -1 && (brace === -1 || semi < brace)) { index = semi + 1; continue; }
      const prelude = css.slice(index, brace).trim();
      index = brace + 1;
      const body = block();
      if (/^@(media|supports)/.test(prelude)) out.push({ at: prelude, rules: parse(body) });
      continue;
    }
    const brace = css.indexOf("{", index);
    if (brace === -1) break;
    const selector = css.slice(index, brace).trim();
    index = brace + 1;
    out.push({ selector, body: block() });
  }
  return out;
}

function prefix(selector) {
  return selector.split(",").map((part) => {
    const s = part.trim();
    if (s === ":root" || s === "html") return 'html[data-theme="dark"]';
    if (s.startsWith(":root")) return `html[data-theme="dark"]${s.slice(5)}`;
    if (s.startsWith("html")) return `html[data-theme="dark"]${s.slice(4)}`;
    return `${PREFIX} ${s}`;
  }).join(", ");
}

function emit(rules) {
  const lines = [];
  for (const rule of rules) {
    if (rule.at) { const inner = emit(rule.rules); if (inner.length) lines.push(`${rule.at} {`, ...inner.map((line) => `  ${line}`), "}"); continue; }
    // O menu lateral, e a tela de login já foram desenhados para fundo escuro/colorido.
    if (/\.sidebar|\.brand|\.login-|\.hero-status|\.overview-hero/.test(rule.selector)) continue;
    const declarations = rule.body.split(";").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const colon = entry.indexOf(":");
      if (colon < 0) return null;
      const prop = entry.slice(0, colon).trim();
      const value = entry.slice(colon + 1).trim();
      if (!COLOR_PROPS.test(prop) || !/#[0-9a-fA-F]{3,8}\b|\bwhite\b|rgba?\(/i.test(value)) return null;
      const next = convertValue(value, prop);
      return next === value ? null : `${prop}: ${next}`;
    }).filter(Boolean);
    if (declarations.length) lines.push(`${prefix(rule.selector)} { ${declarations.join("; ")}; }`);
  }
  return lines;
}

const lines = emit(parse(source));
const header = [
  "/* Gerado por scripts/build-dark-theme.mjs a partir de globals.css. Não edite à mão: rode o script de novo. */",
  'html[data-theme="dark"] { color-scheme: dark; }',
  ':where(html[data-theme="dark"]) img:not([src$=".svg"]) { filter: brightness(.92); }',
];
// O fundo da página fica um pouco mais escuro que os cartões.
lines.push('html[data-theme="dark"] { --canvas: #0d141f; }', ':where(html[data-theme="dark"]) body { background: #0d141f; }');
writeFileSync(new URL("../app/dark-theme.css", import.meta.url), [...header, ...lines, ""].join("\n"));
console.log(`dark-theme.css: ${lines.length} regras`);

// White label: nome, logo e cor da empresa. Regras puras (sem banco), usadas no servidor e na tela "Marca".
// A partir de UMA cor gera todos os tokens --brand-* do sistema visual, no tema claro e no escuro
// (o escuro segue a mesma conta do scripts/build-dark-theme.mjs).

export const DEFAULT_BRAND_COLOR = "#2f6fed";

export type Brand = {
  /** Nome completo (login, aba do navegador, mensagens). */
  name: string;
  /** Nome curto (ícone na tela inicial do celular). */
  shortName: string;
  /** Frase curta embaixo do nome no menu e no login. */
  tagline: string;
  /** Cor principal, em #rrggbb. */
  color: string;
  /** Logo no armazenamento de arquivos (media/brand/...), ou null para o ícone padrão. */
  logoKey: string | null;
  /** Ícones de instalar no celular/computador (PNG quadrado 512 e 192), gerados do logo no envio. */
  iconKey: string | null;
  iconSmallKey: string | null;
  updatedAt: string | null;
};

export const DEFAULT_BRAND: Brand = { name: "Portal da Equipe", shortName: "Portal", tagline: "Sistema interno", color: DEFAULT_BRAND_COLOR, logoKey: null, iconKey: null, iconSmallKey: null, updatedAt: null };

export const BRAND_LIMITS = { name: 40, shortName: 16, tagline: 40 };
export const BRAND_PRESETS = ["#2f6fed", "#0f766e", "#15803d", "#7c3aed", "#c2410c", "#be123c", "#0369a1", "#334155"];

export const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export const isBrandLogoKey = (value: unknown): value is string => typeof value === "string" && /^media\/brand\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(value);

const clean = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Marca salva (texto JSON do banco) → marca válida; o que faltar ou vier errado volta ao padrão. */
export function parseBrand(raw: string | null | undefined): Brand {
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { data = {}; }
  return {
    name: clean(data.name, BRAND_LIMITS.name) || DEFAULT_BRAND.name,
    shortName: clean(data.shortName, BRAND_LIMITS.shortName) || DEFAULT_BRAND.shortName,
    // Frase apagada de propósito fica vazia; nunca salva, usa a padrão.
    tagline: "tagline" in data ? clean(data.tagline, BRAND_LIMITS.tagline) : DEFAULT_BRAND.tagline,
    color: isHexColor(data.color) ? data.color.toLowerCase() : DEFAULT_BRAND.color,
    logoKey: isBrandLogoKey(data.logoKey) ? data.logoKey : null,
    iconKey: isBrandLogoKey(data.iconKey) ? data.iconKey : null,
    iconSmallKey: isBrandLogoKey(data.iconSmallKey) ? data.iconSmallKey : null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  };
}

/** Confere o que veio da tela antes de salvar. Devolve a mensagem do problema ou null. */
export function brandInputError(input: { name?: unknown; shortName?: unknown; tagline?: unknown; color?: unknown }) {
  if (clean(input.name, 200).length < 2) return "Informe o nome do sistema (pelo menos 2 letras).";
  if (clean(input.name, 200).length > BRAND_LIMITS.name) return `O nome pode ter até ${BRAND_LIMITS.name} caracteres.`;
  if (clean(input.shortName, 200).length > BRAND_LIMITS.shortName) return `O nome curto pode ter até ${BRAND_LIMITS.shortName} caracteres.`;
  if (clean(input.tagline, 200).length > BRAND_LIMITS.tagline) return `A frase pode ter até ${BRAND_LIMITS.tagline} caracteres.`;
  if (!isHexColor(input.color)) return "Escolha uma cor válida.";
  return null;
}

// ----- cores -----
type Rgb = [number, number, number];
const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255) as Rgb;
const rgbToHex = (rgb: Rgb) => "#" + rgb.map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0")).join("");
/** Mistura a cor com outra (amount = quanto da outra entra). */
export const mix = (hex: string, other: string, amount: number) => {
  const a = hexToRgb(hex), b = hexToRgb(other);
  return rgbToHex(a.map((value, index) => value + (b[index] - value) * amount) as Rgb);
};
const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Contraste WCAG entre duas cores (1 a 21). */
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

function rgbToHsl([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToHex([h, s, l]: Rgb) {
  const f = (n: number) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return rgbToHex([f(0), f(8), f(4)]);
}
/** Mesma conta do gerador do tema escuro: fundos claros escurecem, textos coloridos clareiam um pouco. */
function darkVariant(hex: string, asText: boolean) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  if (l >= 0.8) return hslToHex([s < 0.15 ? 0.6 : h, s < 0.15 ? 0.22 : Math.min(s, 0.45), 0.13 + (1 - l) * 1.1]);
  if (asText && l < 0.6) return hslToHex([h, s, Math.min(0.75, l + 0.22)]);
  return hex;
}

const WHITE = "#ffffff";
const INK = "#101828";
const DARK_SURFACE = "#1a2028";

/** Escurece (ou clareia) aos poucos até ter contraste suficiente contra o fundo. */
function readableOn(hex: string, background: string, target: number, toward: string) {
  let value = hex;
  for (let step = 0; step < 20 && contrast(value, background) < target; step += 1) value = mix(value, toward, 0.08);
  return value;
}

export type BrandPalette = { light: Record<string, string>; dark: Record<string, string> };

/** Todos os tokens da marca a partir de uma cor. */
export function brandPalette(color: string): BrandPalette {
  const brand = isHexColor(color) ? color.toLowerCase() : DEFAULT_BRAND_COLOR;
  const hover = mix(brand, "#000000", 0.18);
  const text = readableOn(hover, WHITE, 4.5, "#000000");
  const light = {
    "--brand": brand,
    "--brand-hover": hover,
    "--brand-text": text,
    "--brand-soft": mix(brand, WHITE, 0.92),
    "--brand-softer": mix(brand, WHITE, 0.95),
    "--brand-muted": mix(brand, WHITE, 0.83),
    "--brand-border": mix(brand, WHITE, 0.5),
    // Texto em cima da cor: branco, ou escuro quando a cor é clara demais para branco.
    "--on-brand": contrast(WHITE, brand) >= 3 ? WHITE : INK,
    // Usados no menu lateral e no login, que são escuros nos dois temas.
    "--brand-ink": text,
    "--brand-on-dark": mix(brand, WHITE, 0.83),
    "--brand-deep": mix(brand, "#0b1220", 0.62),
  };
  const dark = {
    "--brand-text": readableOn(darkVariant(text, true), DARK_SURFACE, 4.5, WHITE),
    "--brand-soft": darkVariant(light["--brand-soft"], false),
    "--brand-softer": darkVariant(light["--brand-softer"], false),
    "--brand-muted": darkVariant(light["--brand-muted"], false),
  };
  return { light, dark };
}

/** CSS que aplica a marca por cima do padrão (vazio quando a cor é a padrão: o visual fica idêntico ao original). */
export function brandCss(color: string) {
  if (!isHexColor(color) || color.toLowerCase() === DEFAULT_BRAND_COLOR) return "";
  const { light, dark } = brandPalette(color);
  const block = (values: Record<string, string>) => Object.entries(values).map(([key, value]) => `${key}:${value}`).join(";");
  // Seletores um pouco mais fortes que os do globals.css e do dark-theme.css, para valerem em qualquer ordem.
  return `html:root{${block(light)}}html[data-theme="dark"]:root{${block(dark)}}`;
}

/** Endereço público do logo (o login precisa dele antes de alguém entrar). */
export const brandLogoUrl = (brand: Pick<Brand, "logoKey" | "updatedAt">) => (brand.logoKey ? `/api/brand?logo=1&v=${encodeURIComponent(brand.logoKey.slice(12, 20))}` : null);

/** Ícone de instalar gerado do logo (512 ou 192), ou null para os ícones padrão. */
export const brandIconUrl = (brand: Pick<Brand, "iconKey" | "iconSmallKey">, size: 512 | 192) => {
  const key = size === 512 ? brand.iconKey : brand.iconSmallKey;
  return key ? `/api/brand?icon=${size}&v=${encodeURIComponent(key.slice(12, 20))}` : null;
};

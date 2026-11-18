import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BRAND, brandCss, brandInputError, brandPalette, contrast, isBrandLogoKey, parseBrand } from "../app/brand-theme.ts";

test("marca padrão não injeta CSS (visual idêntico ao original)", () => {
  assert.equal(brandCss(DEFAULT_BRAND.color), "");
  assert.equal(brandCss("#2F6FED"), "");
});

test("cor da empresa gera tokens claros e escuros legíveis", () => {
  for (const color of ["#0f766e", "#be123c", "#facc15", "#000000", "#ffffff", "#7c3aed"]) {
    const { light, dark } = brandPalette(color);
    assert.ok(contrast(light["--brand-text"], "#ffffff") >= 4.5, `texto claro legível para ${color}`);
    assert.ok(contrast(dark["--brand-text"], "#1a2028") >= 4.5, `texto escuro legível para ${color}`);
    assert.ok(contrast(light["--on-brand"], light["--brand"]) >= 3, `texto do botão legível para ${color}`);
  }
  assert.equal(brandPalette("#facc15").light["--on-brand"], "#101828");
  assert.equal(brandPalette("#0f766e").light["--on-brand"], "#ffffff");
  const css = brandCss("#0f766e");
  assert.match(css, /^html:root\{--brand:#0f766e;/);
  assert.match(css, /html\[data-theme="dark"\]:root\{--brand-text:/);
});

test("marca salva inválida volta ao padrão, sem HTML", () => {
  assert.deepEqual(parseBrand("não é json"), DEFAULT_BRAND);
  const brand = parseBrand(JSON.stringify({ name: "  <b>Hermanos</b>  ", color: "vermelho", logoKey: "secrets/encryption-key-v1", tagline: "x".repeat(90) }));
  assert.equal(brand.name, "bHermanos/b");
  assert.equal(brand.color, DEFAULT_BRAND.color);
  assert.equal(brand.logoKey, null);
  assert.equal(brand.tagline.length, 40);
  assert.equal(brand.shortName, DEFAULT_BRAND.shortName);
});

test("só aceita logo da pasta da marca", () => {
  assert.ok(isBrandLogoKey("media/brand/0f8b5a2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png"));
  assert.ok(!isBrandLogoKey("media/profiles/0f8b5a2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png"));
  assert.ok(!isBrandLogoKey("media/brand/../secrets/x.png"));
  assert.ok(!isBrandLogoKey("media/brand/0f8b5a2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.svg"));
});

test("validação do formulário", () => {
  assert.equal(brandInputError({ name: "Hermanos", color: "#123abc" }), null);
  assert.match(brandInputError({ name: "H", color: "#123abc" }) ?? "", /nome/);
  assert.match(brandInputError({ name: "Hermanos", color: "123abc" }) ?? "", /cor/);
  assert.match(brandInputError({ name: "Hermanos", shortName: "x".repeat(30), color: "#123abc" }) ?? "", /curto/);
});

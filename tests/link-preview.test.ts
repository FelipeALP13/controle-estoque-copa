import { test } from "node:test";
import assert from "node:assert/strict";
import { firstLink, isSafePublicUrl, parsePreview } from "../app/link-preview.ts";

test("acha o primeiro link fora de código e sem a pontuação do fim", () => {
  assert.equal(firstLink("veja https://exemplo.com.br/doc?id=1. valeu"), "https://exemplo.com.br/doc?id=1");
  assert.equal(firstLink("`https://codigo.com` e depois https://site.com/a"), "https://site.com/a");
  assert.equal(firstLink("```\nhttps://bloco.com\n```"), null);
  assert.equal(firstLink("sem link"), null);
});

test("só endereços públicos", () => {
  assert.equal(isSafePublicUrl("https://www.google.com/"), true);
  assert.equal(isSafePublicUrl("http://localhost:3000"), false);
  assert.equal(isSafePublicUrl("http://127.0.0.1/"), false);
  assert.equal(isSafePublicUrl("http://192.168.0.10/"), false);
  assert.equal(isSafePublicUrl("http://10.1.2.3/"), false);
  assert.equal(isSafePublicUrl("http://172.20.0.1/"), false);
  assert.equal(isSafePublicUrl("http://169.254.169.254/latest"), false);
  assert.equal(isSafePublicUrl("http://[::1]/"), false);
  assert.equal(isSafePublicUrl("https://intranet/"), false);
  assert.equal(isSafePublicUrl("https://site.local/"), false);
  assert.equal(isSafePublicUrl("https://user:pw@site.com/"), false);
  assert.equal(isSafePublicUrl("https://site.com:8443/"), false);
  assert.equal(isSafePublicUrl("ftp://site.com/"), false);
  assert.equal(isSafePublicUrl("https://8.8.8.8/"), true);
});

test("lê título, descrição, site e imagem", () => {
  const html = `<html><head><title>Fallback</title>
    <meta property="og:title" content="Relat&oacute;rio &amp; metas">
    <meta name="description" content='Resumo do mês'>
    <meta property="og:site_name" content="Exemplo">
    <meta property="og:image" content="/img/capa.png">
  </head></html>`;
  assert.deepEqual(parsePreview(html, "https://www.exemplo.com/a"), { url: "https://www.exemplo.com/a", title: "Relatório & metas", description: "Resumo do mês", siteName: "Exemplo", image: "https://www.exemplo.com/img/capa.png" });
  assert.deepEqual(parsePreview("<title> Só título </title>", "https://www.site.com/x"), { url: "https://www.site.com/x", title: "Só título", description: "", siteName: "site.com", image: null });
  assert.equal(parsePreview("<p>nada</p>", "https://site.com"), null);
  assert.equal(parsePreview('<title>T</title><meta property="og:image" content="http://127.0.0.1/x.png">', "https://site.com")?.image, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentError, cleanFileName, contentDisposition, contentMatches, extensionOf, formatSize } from "../app/attachments.ts";

test("tipos e tamanho aceitos", () => {
  assert.equal(attachmentError("print.PNG", 1000), null);
  assert.equal(attachmentError("relatorio.xlsx", 5 * 1024 * 1024), null);
  assert.match(attachmentError("programa.exe", 10) ?? "", /não aceito/);
  assert.match(attachmentError("sem-extensao", 10) ?? "", /não aceito/);
  assert.match(attachmentError("grande.pdf", 11 * 1024 * 1024) ?? "", /10 MB/);
  assert.match(attachmentError("vazio.txt", 0) ?? "", /vazio/);
});

test("nome do arquivo", () => {
  assert.equal(extensionOf("Foto.JPEG"), "jpeg");
  assert.equal(cleanFileName("C:\\Users\\ana\\Desktop\\erro: tela?.png"), "erro tela.png");
  assert.equal(cleanFileName("   "), "arquivo");
  const long = cleanFileName(`${"a".repeat(200)}.pdf`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".pdf"));
});

test("conteúdo bate com a extensão", () => {
  assert.equal(contentMatches("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])), true);
  assert.equal(contentMatches("png", new TextEncoder().encode("MZ fake")), false);
  assert.equal(contentMatches("pdf", new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(contentMatches("docx", new Uint8Array([0x50, 0x4b, 3, 4])), true);
  assert.equal(contentMatches("txt", new TextEncoder().encode("qualquer")), true);
});

test("tamanho legível e nome no download", () => {
  assert.equal(formatSize(500), "500 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(1.5 * 1024 * 1024), "1,5 MB");
  assert.equal(contentDisposition("ação.pdf", true), "inline; filename=\"acao.pdf\"; filename*=UTF-8''a%C3%A7%C3%A3o.pdf");
});

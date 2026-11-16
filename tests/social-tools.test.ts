import { test } from "node:test";
import assert from "node:assert/strict";
import { channelSlug, dmKey, dmMembers, groupMessages, groupReactions, isReaction, localInputToIso, mapGiphy, parseChatAttachments, parseInline, parseMarkdown, personStatus, reminderError, reminderPresets, splitLinks, statusUntil, taskTitleFromMessage, typingText, untilText } from "../app/social-tools.ts";

test("canais e conversas diretas", () => {
  assert.equal(channelSlug("  #Liderança Técnica! "), "lideranca-tecnica");
  assert.equal(channelSlug("off_topic"), "off-topic");
  assert.equal(channelSlug("###"), "");
  assert.equal(dmKey(7, 3), "3:7");
  assert.equal(dmKey(3, 7), "3:7");
  assert.deepEqual(dmMembers("3:7"), [3, 7]);
  assert.deepEqual(dmMembers(null), []);
});

test("mensagens seguidas da mesma pessoa ficam juntas", () => {
  const groups = groupMessages([
    { id: 1, memberId: 1, createdAt: "2026-11-13T10:00:00.000Z" },
    { id: 2, memberId: 1, createdAt: "2026-11-13T10:03:00.000Z" },
    { id: 3, memberId: 2, createdAt: "2026-11-13T10:04:00.000Z" },
    { id: 4, memberId: 2, createdAt: "2026-11-13T10:20:00.000Z" },
    { id: 5, memberId: 2, createdAt: "2026-11-13T10:21:00.000Z", replyToId: 1 },
  ]);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [[1, 2], [3], [4], [5]], "nova pessoa, mais de 5 min ou resposta abrem grupo novo");
});

test("reações", () => {
  assert.equal(isReaction("👍"), true);
  assert.equal(isReaction("💩"), false);
  assert.equal(isReaction("🔥"), true, "qualquer emoji do seletor vale como reação");
  const grouped = groupReactions([{ emoji: "🎉", memberId: 2 }, { emoji: "👍", memberId: 1 }, { emoji: "👍", memberId: 3 }], 1, (id) => `P${id}`);
  assert.deepEqual(grouped, [{ emoji: "👍", count: 2, mine: true, names: ["P1", "P3"] }, { emoji: "🎉", count: 1, mine: false, names: ["P2"] }]);
});

test("links", () => {
  assert.deepEqual(splitLinks("veja https://exemplo.com.br/a?b=1. ok"), [{ text: "veja ", href: null }, { text: "https://exemplo.com.br/a?b=1", href: "https://exemplo.com.br/a?b=1" }, { text: ". ok", href: null }]);
  assert.deepEqual(splitLinks("sem link"), [{ text: "sem link", href: null }]);
});

test("formatação estilo chat", () => {
  assert.deepEqual(parseInline("oi **forte** e *leve* `x = 1` ||segredo|| ~~não~~ __sub__"), [
    { type: "text", text: "oi " }, { type: "bold", text: "forte" }, { type: "text", text: " e " }, { type: "italic", text: "leve" }, { type: "text", text: " " },
    { type: "code", text: "x = 1" }, { type: "text", text: " " }, { type: "spoiler", text: "segredo" }, { type: "text", text: " " }, { type: "strike", text: "não" }, { type: "text", text: " " }, { type: "underline", text: "sub" },
  ]);
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ type: "text", text: "2 * 3 * 4" }], "asterisco solto não vira itálico");
  assert.deepEqual(parseInline("nome_do_arquivo.txt"), [{ type: "text", text: "nome_do_arquivo.txt" }], "sublinhado no meio da palavra não vira itálico");
  const blocks = parseMarkdown("> citação\nlinha normal\n```sql\nselect 1;\n```\nfim");
  assert.deepEqual(blocks.map((block) => block.type), ["quote", "paragraph", "codeblock", "paragraph"]);
  assert.equal(blocks[2].type === "codeblock" && blocks[2].text, "select 1;");
});

test("anexos, GIFs do Giphy e quem está digitando", () => {
  const key = "media/chat/0b9f4f3e-1d2c-4c5a-9b8e-7a6d5c4b3a21.gif";
  const gif = "https://media2.giphy.com/media/abc123/200.gif";
  assert.deepEqual(parseChatAttachments([{ kind: "upload", key }, { kind: "upload", key: "media/feed/x.png" }, { kind: "gif", url: gif, width: "200", height: 150 }, { kind: "gif", url: "https://site-estranho.com/x.gif" }]), [{ kind: "upload", key }, { kind: "gif", url: gif, width: 200, height: 150 }]);
  assert.equal(parseChatAttachments(Array.from({ length: 6 }, () => ({ kind: "upload", key }))).length, 4);
  assert.deepEqual(mapGiphy({ data: [{ id: "a1", title: "oi", images: { fixed_height: { url: "https://media1.giphy.com/media/a1/200.gif?cid=x", width: "267", height: "200" }, fixed_height_small: { url: "https://media1.giphy.com/media/a1/100.gif?cid=x" } } }, { id: "sem-imagem" }] }), [{ id: "a1", title: "oi", url: "https://media1.giphy.com/media/a1/200.gif", preview: "https://media1.giphy.com/media/a1/100.gif", width: 267, height: 200 }]);
  assert.deepEqual(mapGiphy(null), []);
  assert.equal(typingText(["Ana Lima"]), "Ana está digitando…");
  assert.equal(typingText(["Ana", "Bruno", "Caio"]), "Ana, Bruno e Caio estão digitando…");
  assert.equal(typingText(["A", "B", "C", "D"]), "Várias pessoas estão digitando…");
});

test("status no chat", () => {
  const now = new Date("2026-11-16T15:00:00Z"); // 12:00 em Brasília
  assert.equal(statusUntil("30m", now), "2026-11-16T15:30:00.000Z");
  assert.equal(statusUntil("today", now), "2026-11-17T02:59:00.000Z");
  assert.equal(statusUntil("none", now), null);
  assert.equal(statusUntil("sempre", now), undefined);
  assert.deepEqual(personStatus({ kind: "lunch", until: "2026-11-16T16:00:00Z" }, null, now), { kind: "lunch", label: "Almoço", until: "2026-11-16T16:00:00Z" });
  assert.equal(personStatus({ kind: "lunch", until: "2026-11-16T14:00:00Z" }, null, now), null, "vencido some");
  assert.equal(personStatus({ kind: "dormindo", until: null }, null, now), null);
  assert.deepEqual(personStatus({ kind: "meeting", until: null }, "Férias até 20/11", now), { kind: "absence", label: "Férias até 20/11", until: null }, "férias valem mais");
  assert.equal(untilText("2026-11-16T17:30:00Z", now), "14:30");
  assert.equal(untilText("2026-11-17T12:00:00Z", now), "amanhã 09:00");
  assert.equal(untilText("2026-11-20T21:00:00Z", now), "20/11 18:00");
});

test("lembretes de mensagem", () => {
  const now = new Date("2026-11-18T15:00:00Z"); // quarta, 12:00
  const presets = reminderPresets(now);
  assert.equal(presets.find((p) => p.label === "Amanhã às 9h")?.at, "2026-11-19T12:00:00.000Z");
  assert.equal(presets.find((p) => p.label === "Segunda às 9h")?.at, "2026-11-23T12:00:00.000Z");
  assert.equal(reminderPresets(new Date("2026-11-22T15:00:00Z")).some((p) => p.label === "Segunda às 9h"), false, "no domingo, amanhã já é segunda");
  assert.equal(localInputToIso("2026-11-20T08:30"), "2026-11-20T11:30:00.000Z");
  assert.equal(localInputToIso("amanhã"), null);
  assert.equal(reminderError("2026-11-18T14:00:00Z", now), "Escolha um horário no futuro.");
  assert.equal(reminderError("2027-06-01T12:00:00Z", now), "Lembretes valem por até 90 dias.");
  assert.equal(reminderError("x", now), "Escolha quando lembrar.");
  assert.equal(reminderError(presets[0].at, now), null);
  assert.equal(taskTitleFromMessage("> citação\n**Corrigir** o _relatório_ do cliente"), "citação");
  assert.equal(taskTitleFromMessage("```\ncódigo\n```\nVer o erro do SGE"), "Ver o erro do SGE");
  assert.equal(taskTitleFromMessage("a".repeat(200)).length, 118);
});

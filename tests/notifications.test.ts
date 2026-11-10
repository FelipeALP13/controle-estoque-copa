import assert from "node:assert/strict";
import test from "node:test";
import { commentRecipients, findMentions, notificationText, snippet, splitMentions, statusRecipients } from "../app/notifications.ts";

const people = [
  { id: 1, name: "Lucas" },
  { id: 2, name: "Lucas Boroto" },
  { id: 3, name: "Caio Viana" },
  { id: 4, name: "Ângelo" },
];

test("encontra menções pelo nome completo, sem confundir nomes parecidos", () => {
  assert.deepEqual(findMentions("@Lucas Boroto pode ver?", people), [2]);
  assert.deepEqual(findMentions("@lucas e @caio viana, olhem isso", people), [1, 3]);
  assert.deepEqual(findMentions("Fala @Ângelo!", people), [4]);
  assert.deepEqual(findMentions("email@Lucas.com e @Lucasx", people), []);
});

test("destaca as menções no texto", () => {
  assert.deepEqual(splitMentions("Oi @Caio Viana, tudo certo", people), [
    { text: "Oi ", mention: false },
    { text: "@Caio Viana", mention: true },
    { text: ", tudo certo", mention: false },
  ]);
});

test("define quem recebe aviso de comentário", () => {
  const recipients = commentRecipients({ actorId: 1, assigneeId: 3, creatorId: 1, participantIds: [2, 3], mentionedIds: [3, 1] });
  assert.deepEqual([...recipients.entries()], [[3, "task_mention"], [2, "task_comment"]]);
});

test("avisa responsável e autor sobre mudança de status, menos quem mudou", () => {
  assert.deepEqual(statusRecipients(1, 3, 1), [3]);
  assert.deepEqual(statusRecipients(1, null, 2), [2]);
  assert.deepEqual(statusRecipients(1, 1, 1), []);
});

test("monta os textos dos avisos", () => {
  assert.equal(notificationText("task_assigned", "Ana", ""), "Ana atribuiu uma tarefa a você");
  assert.equal(notificationText("task_status", "Ana", "Concluída"), "Ana mudou o status para Concluída");
  assert.equal(snippet("a".repeat(10), 5), "aaaa…");
  assert.equal(notificationText("ticket_new", "Ana", ""), "Ana abriu um chamado para o seu time");
  assert.equal(notificationText("ticket_mention", "Ana", ""), "Ana mencionou você");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { checklistProgress, cleanItem, exampleTemplates, MAX_CHECKLIST_ITEMS, parseItems } from "../app/checklists.ts";

test("passos digitados um por linha, com marcadores", () => {
  assert.deepEqual(parseItems("- Reunião inicial\n\n1. Receber acessos\n2) Configurar  ambiente\n[ ] Treinar\n[x] Validar\n• Publicar"), ["Reunião inicial", "Receber acessos", "Configurar ambiente", "Treinar", "Validar", "Publicar"]);
  assert.deepEqual(parseItems('["A", " B ", ""]'), ["A", "B"]);
  assert.deepEqual(parseItems(["Um", null, "Dois"]), ["Um", "Dois"]);
  // JSON inválido: vira texto comum, como foi digitado.
  assert.deepEqual(parseItems("[quebrado"), ["[quebrado"]);
  assert.deepEqual(parseItems(undefined), []);
  assert.equal(parseItems(Array.from({ length: 80 }, (_, i) => `Passo ${i}`)).length, MAX_CHECKLIST_ITEMS);
  assert.equal(cleanItem("x".repeat(300)).length, 200);
});

test("progresso do checklist", () => {
  assert.deepEqual(checklistProgress([]), { done: 0, total: 0, percent: 0, complete: false });
  assert.deepEqual(checklistProgress([{ done: true }, { done: false }, { done: true }]), { done: 2, total: 3, percent: 67, complete: false });
  assert.equal(checklistProgress([{ done: true }]).complete, true);
});

test("modelos de exemplo bem formados", () => {
  for (const template of exampleTemplates) {
    assert.ok(template.name && template.items.length >= 5);
    assert.deepEqual(parseItems([...template.items]), [...template.items]);
  }
});

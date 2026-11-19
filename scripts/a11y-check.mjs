// Verificação de acessibilidade no código (sem navegador): acha
//  - campos (input, select, textarea) sem rótulo: sem <label> em volta, sem aria-label/aria-labelledby e sem id ligado a um htmlFor;
//  - botões só com ícone e sem nome (aria-label, aria-labelledby ou title);
//  - imagens sem alt.
// Uso: node scripts/a11y-check.mjs   (sai com código 1 se achar algo)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../app/", import.meta.url));
const files = readdirSync(root, { recursive: true }).filter((file) => file.endsWith(".tsx") && !path.basename(file).startsWith("_"));
const problems = [];

const tagName = (node) => node.tagName.getText();
const attrNames = (node) => new Set(node.attributes.properties.filter(ts.isJsxAttribute).map((attr) => attr.name.getText()));
const attrValue = (node, name) => {
  const attr = node.attributes.properties.find((entry) => ts.isJsxAttribute(entry) && entry.name.getText() === name);
  if (!attr?.initializer) return attr ? true : undefined;
  return ts.isStringLiteral(attr.initializer) ? attr.initializer.text : attr.initializer.getText();
};
const hasSpread = (node) => node.attributes.properties.some(ts.isJsxSpreadAttribute);

function insideLabel(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current) && tagName(current.openingElement) === "label") return true;
  }
  return false;
}

/** Conteúdo do botão tem texto (literal ou expressão que não seja só um componente de ícone)? */
function hasText(children) {
  return children.some((child) => {
    if (ts.isJsxText(child)) return child.getText().trim() !== "";
    if (ts.isJsxExpression(child)) return Boolean(child.expression) && !/^\s*<[A-Z]/.test(child.expression.getText()) && !/^\s*\w+\s*&&\s*<[A-Z][^>]*\/>\s*$/.test(child.expression.getText());
    if (ts.isJsxElement(child)) return hasText(child.children);
    return false;
  });
}

for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const htmlFor = new Set();
  source.forEachChild(function collect(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tagName(node) === "label") {
      const value = attrValue(node, "htmlFor");
      if (typeof value === "string") htmlFor.add(value);
    }
    node.forEachChild(collect);
  });
  const report = (node, message) => problems.push(`app/${file.replace(/\\/g, "/")}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${message}`);
  source.forEachChild(function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tagName(node);
      const attrs = attrNames(node);
      const named = attrs.has("aria-label") || attrs.has("aria-labelledby") || hasSpread(node);
      if (["input", "select", "textarea"].includes(name)) {
        const type = attrValue(node, "type");
        const skip = type === "hidden" || attrs.has("hidden") || (type === "file" && attrs.has("hidden"));
        const id = attrValue(node, "id");
        if (!skip && !named && !insideLabel(node) && !(typeof id === "string" && htmlFor.has(id))) report(node, `${name} sem rótulo`);
      }
      if ((name === "img" || name === "Image") && !attrs.has("alt") && !hasSpread(node)) report(node, `${name} sem alt`);
      if (name === "button" && ts.isJsxOpeningElement(node) && !named && !attrs.has("title")) {
        const element = node.parent;
        if (ts.isJsxElement(element) && !hasText(element.children)) report(node, "botão só com ícone, sem nome");
      }
    }
    node.forEachChild(visit);
  });
}

console.log(problems.length ? problems.join("\n") : "Nenhum problema encontrado.");
console.log(`${problems.length} problema(s) em ${files.length} arquivos.`);
process.exit(problems.length ? 1 : 0);

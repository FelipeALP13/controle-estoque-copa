import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildXlsx, columnLetter, crc32, excelDate, safeSheetName, xmlText } from "../app/xlsx-writer.ts";
import { readXlsx } from "../app/xlsx-reader.ts";

const inflate = async (data: Uint8Array) => new Uint8Array(inflateRawSync(data));

test("letras de coluna", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(701), "ZZ");
  assert.equal(columnLetter(702), "AAA");
});

test("crc32 confere com o valor padrão", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("datas viram número de série do Excel", () => {
  assert.equal(excelDate("1970-01-01"), 25569);
  assert.equal(excelDate("2026-11-11"), 46337);
  assert.equal(excelDate("sem data"), null);
});

test("nomes de aba válidos e sem repetir", () => {
  const used = new Set<string>();
  assert.equal(safeSheetName("Carga / pessoa?", used), "Carga pessoa");
  assert.equal(safeSheetName("carga pessoa", used), "carga pessoa (2)");
  assert.equal(safeSheetName("x".repeat(40), used).length, 31);
});

test("texto escapado e sem caracteres de controle", () => {
  assert.equal(xmlText("a<b & \"c\"\u0001"), "a&lt;b &amp; &quot;c&quot;");
});

test("arquivo gerado é lido de volta com os mesmos valores", async () => {
  const bytes = buildXlsx([
    {
      name: "Demandas",
      columns: [{ header: "Código" }, { header: "Título" }, { header: "Prazo", type: "date" }, { header: "Horas", type: "number" }, { header: "Conclusão", type: "percent" }],
      rows: [
        ["DEM-1", "Ajustar <relatório> & exportar", "2026-11-11", 2.5, 0.75],
        ["DEM-2", "Ação com acentuação ç ã é", null, 0, null],
        ["DEM-3", "  espaços  ", "data ruim", undefined, 1],
      ],
    },
    { name: "Vazia", columns: [], rows: [] },
  ]);
  const sheets = await readXlsx(bytes, inflate);
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["Demandas", "Vazia"]);
  assert.deepEqual(sheets[0].rows[0], ["Código", "Título", "Prazo", "Horas", "Conclusão"]);
  assert.deepEqual(sheets[0].rows[1], ["DEM-1", "Ajustar <relatório> & exportar", "2026-11-11", "2.5", "0.75"]);
  assert.deepEqual(sheets[0].rows[2], ["DEM-2", "Ação com acentuação ç ã é", "", "0"]);
  assert.deepEqual(sheets[0].rows[3], ["DEM-3", "  espaços  ", "data ruim", "", "1"]);
  assert.deepEqual(sheets[1].rows, []);
});

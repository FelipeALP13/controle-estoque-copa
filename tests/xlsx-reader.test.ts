import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { columnIndex, isDateFormat, readXlsx } from "../app/xlsx-reader.ts";

/** Monta um .zip mínimo (deflate) para testar o leitor sem arquivo externo. */
function zip(files: Record<string, string>) {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content, "utf8"));
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(8, 10); header.writeUInt32LE(data.length, 20); header.writeUInt16LE(nameBytes.length, 28); header.writeUInt32LE(offset, 42);
    chunks.push(local, nameBytes, data);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, centralBuffer, end]));
}

const inflate = async (data: Uint8Array) => new Uint8Array(inflateRawSync(data));

test("converte letras de coluna e reconhece formatos de data", () => {
  assert.equal(columnIndex("A1"), 0);
  assert.equal(columnIndex("P4"), 15);
  assert.equal(columnIndex("AA10"), 26);
  assert.equal(isDateFormat(14, undefined), true);
  assert.equal(isDateFormat(164, "dd/mm/yyyy"), true);
  assert.equal(isDateFormat(165, "#,##0.00"), false);
  assert.equal(isDateFormat(166, "[h]:mm"), false);
});

test("lê abas, textos compartilhados, datas, números e células vazias", async () => {
  const bytes = zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Angelo S." sheetId="1" r:id="rId1"/><sheet name="Configura&#231;&#245;es" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml": '<sst><si><t>ID</t></si><si><r><t>CNPJ </t></r><r><t xml:space="preserve">alfanum&#233;rico</t></r></si><si><t>Equipe &amp; Times</t></si></sst>',
    "xl/styles.xml": '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>AS-0001</t></is></c><c r="B3" s="1"><v>46266</v></c><c r="D3"><v>8.5</v></c><c r="E3" t="str"><f>A3</f><v>AS-0001</v></c><c r="F3" s="1"/></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c></row></sheetData></worksheet>',
  });
  const sheets = await readXlsx(bytes, inflate);
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["Angelo S.", "Configurações"]);
  assert.deepEqual(sheets[0].rows, [["ID", "", "CNPJ alfanumérico"], [], ["AS-0001", "2026-09-01", "", "8.5", "AS-0001", ""]]);
  assert.deepEqual(sheets[1].rows, [["Equipe & Times"]]);
});

test("recusa arquivo que não é .xlsx", async () => {
  await assert.rejects(readXlsx(new Uint8Array([1, 2, 3, 4]), inflate), /não parece ser um .xlsx/);
});

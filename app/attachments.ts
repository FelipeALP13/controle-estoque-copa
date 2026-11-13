// Anexos de demandas e chamados: regras puras (tipos aceitos, tamanho, nome do arquivo).

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ITEM = 30;

/** Tipos aceitos, pela extensão do arquivo. `inline`: pode abrir direto no navegador. */
export const ATTACHMENT_TYPES: Record<string, { mime: string; inline?: boolean; label: string }> = {
  png: { mime: "image/png", inline: true, label: "Imagem" },
  jpg: { mime: "image/jpeg", inline: true, label: "Imagem" },
  jpeg: { mime: "image/jpeg", inline: true, label: "Imagem" },
  gif: { mime: "image/gif", inline: true, label: "Imagem" },
  webp: { mime: "image/webp", inline: true, label: "Imagem" },
  pdf: { mime: "application/pdf", inline: true, label: "PDF" },
  txt: { mime: "text/plain", label: "Texto" },
  log: { mime: "text/plain", label: "Log" },
  csv: { mime: "text/csv", label: "Planilha" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Planilha" },
  xls: { mime: "application/vnd.ms-excel", label: "Planilha" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Documento" },
  doc: { mime: "application/msword", label: "Documento" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "Apresentação" },
  zip: { mime: "application/zip", label: "Compactado" },
  xml: { mime: "application/xml", label: "XML" },
  json: { mime: "application/json", label: "JSON" },
  sql: { mime: "text/plain", label: "SQL" },
  eml: { mime: "message/rfc822", label: "E-mail" },
  msg: { mime: "application/vnd.ms-outlook", label: "E-mail" },
};

export const ACCEPT_ATTRIBUTE = Object.keys(ATTACHMENT_TYPES).map((extension) => `.${extension}`).join(",");

export function extensionOf(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return match ? match[1] : "";
}

/** Nome seguro para guardar e mostrar (sem caminho, sem caracteres de controle, até 120 caracteres). */
export function cleanFileName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "arquivo";
  if (cleaned.length <= 120) return cleaned;
  const extension = extensionOf(cleaned);
  return `${cleaned.slice(0, 120 - extension.length - 1).trim()}.${extension}`;
}

/** Confere se um arquivo pode ser anexado. Devolve a mensagem de erro ou null. */
export function attachmentError(fileName: string, size: number) {
  const extension = extensionOf(fileName);
  if (!ATTACHMENT_TYPES[extension]) return `Tipo de arquivo não aceito. Use: imagens, PDF, Word, Excel, PowerPoint, texto, CSV, XML, ZIP ou e-mail.`;
  if (size <= 0) return "O arquivo está vazio.";
  if (size > MAX_ATTACHMENT_BYTES) return `O arquivo passa de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`;
  return null;
}

/** Confere os primeiros bytes de imagens e PDF (o conteúdo precisa bater com a extensão). */
export function contentMatches(extension: string, bytes: Uint8Array) {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (extension === "png") return bytes[0] === 0x89 && text(1, 4) === "PNG";
  if (extension === "jpg" || extension === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === "gif") return text(0, 4) === "GIF8";
  if (extension === "webp") return text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  if (extension === "pdf") return text(0, 5) === "%PDF-";
  if (["xlsx", "docx", "pptx", "zip"].includes(extension)) return bytes[0] === 0x50 && bytes[1] === 0x4b;
  return true;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** Cabeçalho de download com o nome original (acentos inclusive). */
export function contentDisposition(fileName: string, inline: boolean) {
  const ascii = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

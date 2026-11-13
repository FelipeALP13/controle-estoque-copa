"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Download from "lucide-react/icons/download";
import FileIcon from "lucide-react/icons/file";
import FileImage from "lucide-react/icons/file-image";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import FileText from "lucide-react/icons/file-text";
import Paperclip from "lucide-react/icons/paperclip";
import Trash2 from "lucide-react/icons/trash-2";
import Upload from "lucide-react/icons/upload";
import { ACCEPT_ATTRIBUTE, attachmentError, extensionOf, formatSize } from "./attachments";

type Attachment = { id: number; fileName: string; contentType: string; size: number; uploadedById: number | null; uploadedByName: string; createdAt: string; url: string };
type Data = { attachments: Attachment[]; canEdit: boolean; meId: number; isAdmin: boolean };

function iconFor(fileName: string) {
  const extension = extensionOf(fileName);
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) return FileImage;
  if (["xlsx", "xls", "csv"].includes(extension)) return FileSpreadsheet;
  if (["pdf", "doc", "docx", "txt", "log"].includes(extension)) return FileText;
  return FileIcon;
}

const shortDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`));

/** Arquivos anexados a uma demanda ou chamado: enviar (botão ou arrastar), abrir, baixar e excluir. */
export default function AttachmentsPanel({ ownerType, ownerId }: { ownerType: "task" | "ticket"; ownerId: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/attachments?ownerType=${ownerType}&ownerId=${ownerId}`, { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar os anexos.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os anexos.");
    }
  }, [ownerType, ownerId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function upload(files: FileList | File[]) {
    setError("");
    const list = [...files];
    for (const file of list) {
      const problem = attachmentError(file.name, file.size);
      if (problem) { setError(`${file.name}: ${problem}`); continue; }
      setUploading((value) => value + 1);
      try {
        const form = new FormData();
        form.set("ownerType", ownerType);
        form.set("ownerId", String(ownerId));
        form.set("file", file);
        const response = await fetch("/api/attachments", { method: "POST", body: form });
        const json = await response.json() as { error?: string };
        if (!response.ok) throw new Error(json.error || "Não foi possível enviar.");
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : "não foi possível enviar."}`);
      } finally {
        setUploading((value) => value - 1);
      }
    }
    await load();
  }

  async function remove(attachment: Attachment) {
    if (!window.confirm(`Excluir o arquivo “${attachment.fileName}”?`)) return;
    setError("");
    const response = await fetch("/api/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: attachment.id }) });
    const json = await response.json() as { error?: string };
    if (!response.ok) setError(json.error || "Não foi possível excluir.");
    await load();
  }

  const canEdit = Boolean(data?.canEdit);
  const list = data?.attachments ?? [];

  return <section className={`attachments ${dragging ? "dragging" : ""}`}
    onDragOver={(event) => { if (!canEdit) return; event.preventDefault(); setDragging(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={(event) => { if (!canEdit) return; event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void upload(event.dataTransfer.files); }}>
    <div className="attachments-head">
      <h3><Paperclip size={14} /> Anexos {list.length > 0 && <span>{list.length}</span>}</h3>
      {canEdit && <>
        <button type="button" className="link-button" onClick={() => input.current?.click()} disabled={uploading > 0}><Upload size={13} /> {uploading ? "Enviando..." : "Anexar arquivo"}</button>
        <input ref={input} type="file" multiple hidden accept={ACCEPT_ATTRIBUTE} onChange={(event) => { if (event.target.files?.length) void upload(event.target.files); event.target.value = ""; }} />
      </>}
    </div>
    {error && <p className="modal-error">{error}</p>}
    {!data ? null : list.length ? <ul>
      {list.map((attachment) => {
        const Icon = iconFor(attachment.fileName);
        const mine = attachment.uploadedById === data.meId || data.isAdmin;
        return <li key={attachment.id}>
          <span className="attachments-icon"><Icon size={16} /></span>
          <a href={attachment.url} target="_blank" rel="noopener noreferrer" title="Abrir"><strong>{attachment.fileName}</strong><small>{formatSize(attachment.size)} · {attachment.uploadedByName} · {shortDate(attachment.createdAt)}</small></a>
          <a className="attachments-action" href={`${attachment.url}&download=1`} download aria-label={`Baixar ${attachment.fileName}`} title="Baixar"><Download size={14} /></a>
          {canEdit && mine && <button type="button" className="attachments-action" onClick={() => remove(attachment)} aria-label={`Excluir ${attachment.fileName}`} title="Excluir"><Trash2 size={14} /></button>}
        </li>;
      })}
    </ul> : <p className="attachments-empty">{canEdit ? "Nenhum arquivo. Arraste prints, PDFs ou planilhas para cá (até 10 MB cada)." : "Nenhum arquivo anexado."}</p>}
  </section>;
}

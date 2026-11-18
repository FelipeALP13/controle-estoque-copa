// Armazenamento dos arquivos (fotos, imagens do estoque, anexos e imagens do chat).
// Usa o R2 quando existe (computador local e hospedagens com R2) e, sem ele, o Workers KV,
// que é gratuito e não pede cartão na Cloudflare (até 25 MB por arquivo; os anexos têm no máximo 10 MB).
import { env } from "cloudflare:workers";

export type StoredFile = { body: ReadableStream; contentType: string | null; etag: string | null; text(): Promise<string> };

type Bindings = { BUCKET?: R2Bucket; FILES?: KVNamespace };

export interface FileStore {
  get(key: string): Promise<StoredFile | null>;
  put(key: string, bytes: Uint8Array | string, contentType: string): Promise<void>;
  delete(keys: string | string[]): Promise<void>;
}

function r2Store(bucket: R2Bucket): FileStore {
  return {
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return { body: object.body, contentType: object.httpMetadata?.contentType ?? null, etag: object.httpEtag, text: () => object.text() };
    },
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
    async delete(keys) {
      await bucket.delete(keys);
    },
  };
}

function kvStore(kv: KVNamespace): FileStore {
  return {
    async get(key) {
      const found = await kv.getWithMetadata<{ contentType?: string }>(key, "arrayBuffer");
      if (found.value === null) return null;
      const bytes = new Uint8Array(found.value);
      return {
        body: new Response(bytes).body as ReadableStream,
        contentType: found.metadata?.contentType ?? null,
        // As chaves dos arquivos têm um identificador único, então o nome serve de versão.
        etag: `"${key.split("/").pop() ?? key}"`,
        text: async () => new TextDecoder().decode(bytes),
      };
    },
    async put(key, bytes, contentType) {
      await kv.put(key, bytes, { metadata: { contentType } });
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) await kv.delete(key);
    },
  };
}

/** O armazenamento disponível, ou null se a hospedagem não tem nenhum. */
export function fileStoreOrNull(): FileStore | null {
  const bindings = env as unknown as Bindings;
  if (bindings.BUCKET) return r2Store(bindings.BUCKET);
  if (bindings.FILES) return kvStore(bindings.FILES);
  return null;
}

export function fileStore(message = "O armazenamento de arquivos ainda não está disponível."): FileStore {
  const store = fileStoreOrNull();
  if (!store) throw new Error(message);
  return store;
}

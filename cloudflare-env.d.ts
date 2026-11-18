declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Hospedagem própria sem R2: arquivos no Workers KV (gratuito). */
    FILES?: KVNamespace;
    /** Chave de criptografia dos segredos (segredo do Worker; criado pelo scripts/cloudflare.mjs). */
    ENCRYPTION_KEY?: string;
    /** Código secreto para criar o primeiro administrador na hospedagem própria (wrangler secret put SETUP_TOKEN). */
    SETUP_TOKEN?: string;
  }
}

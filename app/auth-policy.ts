export const MIN_PASSWORD_LENGTH = 8;

const commonPasswords = new Set([
  "12345678",
  "password",
  "senha123",
  "admin123",
  "qwerty123",
  "123456789",
]);

export function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, "");
}

export function passwordPolicyError(value: string) {
  if (value.length < MIN_PASSWORD_LENGTH) return `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (!/[a-zA-ZÀ-ÿ]/.test(value) || !/\d/.test(value)) return "A senha precisa combinar letras e números.";
  if (commonPasswords.has(value.toLocaleLowerCase("pt-BR"))) return "Escolha uma senha menos comum.";
  return null;
}

export function validatePassword(value: string) {
  return passwordPolicyError(value) === null;
}

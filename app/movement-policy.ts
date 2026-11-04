export function parseOpeningDate(value: unknown, now = Date.now()) {
  if (!value) return { iso: null, error: null };

  const requestedDate = new Date(String(value));
  if (Number.isNaN(requestedDate.getTime())) return { iso: null, error: "Informe uma data de abertura válida." };
  if (requestedDate.getTime() > now + 60_000) return { iso: null, error: "A data da abertura não pode estar no futuro." };

  return { iso: requestedDate.toISOString(), error: null };
}

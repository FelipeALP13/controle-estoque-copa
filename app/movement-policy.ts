export function parseMovementDate(value: unknown, now = Date.now()) {
  if (!value) return { iso: null, error: null };

  const requestedDate = new Date(String(value));
  if (Number.isNaN(requestedDate.getTime())) return { iso: null, error: "Informe uma data e hora válidas." };
  if (requestedDate.getTime() > now + 60_000) return { iso: null, error: "A data da movimentação não pode estar no futuro." };

  return { iso: requestedDate.toISOString(), error: null };
}

export function movementOccursBeforeOpening(movementAt: string, openedAt: string) {
  return new Date(movementAt).getTime() < new Date(openedAt).getTime();
}

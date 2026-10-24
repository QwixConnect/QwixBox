export function dateBound(
  value: string | undefined,
  upper = false,
): { date: Date; exclusive: boolean } | null {
  if (!value) return null;
  const date = new Date(value);
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (
    Number.isNaN(date.getTime()) ||
    (dayOnly && date.toISOString().slice(0, 10) !== value)
  )
    throw new Error("Invalid date");
  if (upper && dayOnly) date.setUTCDate(date.getUTCDate() + 1);
  return { date, exclusive: upper && dayOnly };
}

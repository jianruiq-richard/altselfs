export function lastCompletedMonthStarts(referenceDate: Date, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error('months must be an integer from 1 to 12');
  }
  const currentMonthStart = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    1,
  ));
  const result: string[] = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    result.push(formatMonthStart(new Date(Date.UTC(
      currentMonthStart.getUTCFullYear(),
      currentMonthStart.getUTCMonth() - offset,
      1,
    ))));
  }
  return result;
}

export function formatMonthStart(value: Date) {
  return value.toISOString().slice(0, 10);
}

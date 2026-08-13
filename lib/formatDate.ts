/** Форматирование дат без server-only зависимостей. */
export function fmtDate(value?: string | Date | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value));
}

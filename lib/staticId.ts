export function isValidStaticId(value: string): boolean {
  return /^\d{2,6}$/.test(String(value || '').trim());
}

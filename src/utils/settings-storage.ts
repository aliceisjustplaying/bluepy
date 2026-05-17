export function restoreShortcutsViewMode(
  value: string | null,
  legacyColumnsMode = false,
): string | null {
  if (typeof value === 'string') return value;
  return legacyColumnsMode ? 'multi-column' : null;
}

export function persistShortcutsViewMode(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function restoreShortcutsColumnsMode(value: boolean | null): boolean {
  return value === true;
}

export function persistShortcutsColumnsMode(value: unknown): boolean {
  return value === true;
}

export function restoreShortcutsViewMode(value: string | null): string | null {
  return value ?? null;
}

export function persistShortcutsViewMode(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

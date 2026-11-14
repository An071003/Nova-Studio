export function readCssVar(name: string): string {
  if (typeof globalThis.document === 'undefined' || typeof globalThis.getComputedStyle !== 'function') {
    return '';
  }
  return globalThis.getComputedStyle(globalThis.document.documentElement).getPropertyValue(name).trim();
}

export function normalizeHexColor(value: string | null | undefined, fallbackVar = '--accent'): string {
  const candidate = value?.trim() ?? '';
  if (/^#[0-9a-fA-F]{6}$/.test(candidate)) {
    return candidate.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(candidate)) {
    const [, r, g, b] = candidate;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const fromVar = readCssVar(fallbackVar);
  if (/^#[0-9a-fA-F]{6}$/.test(fromVar)) {
    return fromVar.toLowerCase();
  }
  return 'transparent';
}

export function toColorInputValue(value: string | null | undefined): string {
  const normalized = normalizeHexColor(value, '--accent');
  return normalized.startsWith('#') ? normalized : readCssVar('--accent').toLowerCase() || 'canvas';
}

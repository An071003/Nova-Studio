export interface SvgSanitizeResult {
  safe: boolean;
  sanitized: string;
  reason?: string;
}

const DISALLOWED_CONTAINER_TAGS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'meta',
];

/**
 * Strips active scripting primitives from user-uploaded SVG markup without
 * requiring DOM/jsdom so both Node workers and CJS NestJS services share it.
 */
export function sanitizeSvgMarkup(raw: string): SvgSanitizeResult {
  if (!raw || raw.includes('\u0000')) {
    return { safe: false, sanitized: '', reason: 'Invalid empty or binary SVG payload' };
  }

  let output = raw.trim();
  if (!/<svg\b/i.test(output)) {
    return { safe: false, sanitized: '', reason: 'Missing root <svg> element' };
  }

  for (const tag of DISALLOWED_CONTAINER_TAGS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
    output = output.replace(paired, '').replace(selfClosing, '');
  }

  // Strip inline DOM event handlers (e.g., onload=, onclick=)
  output = output.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Strip javascript:, vbscript:, or data:text/html URIs in href/xlink:href/src/action attributes
  output = output.replace(
    /\s+(?:xlink:)?(?:href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^"]*"|'\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^']*'|[^\s>]*(?:javascript:|vbscript:)[^\s>]*)/gi,
    '',
  );

  // Neutralize CSS expressions / javascript url() inside style attributes
  output = output.replace(/\s+style\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, _quoted, dbl, sgl) => {
    const css = String(dbl ?? sgl ?? '');
    if (/(?:expression\s*\(|javascript:|vbscript:|behavior\s*:|@import)/i.test(css)) {
      return '';
    }
    return full;
  });

  if (!/<svg\b/i.test(output) || !/<\/svg\s*>/i.test(output)) {
    return { safe: false, sanitized: '', reason: 'Malformed <svg> markup' };
  }

  return { safe: true, sanitized: output };
}

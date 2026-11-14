import { describe, expect, it } from 'vitest';
import { sanitizeSvgMarkup } from './svg-sanitize.js';

describe('sanitizeSvgMarkup', () => {
  it('preserves clean vector SVG markup', () => {
    const clean =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#7C5CFF"/></svg>';
    const res = sanitizeSvgMarkup(clean);
    expect(res.safe).toBe(true);
    expect(res.sanitized).toContain('<rect');
    expect(res.sanitized).toContain('width="120"');
  });

  it('strips script tags, event handlers, foreignObject, and javascript hrefs', () => {
    const dirty = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="alert(1)">',
      '<script>fetch("https://evil.test")</script>',
      '<foreignObject><body><iframe src="https://evil.test"/></body></foreignObject>',
      '<a xlink:href="javascript:alert(2)"><circle cx="32" cy="32" r="20" style="background:url(javascript:alert(3))"/></a>',
      '</svg>',
    ].join('');

    const res = sanitizeSvgMarkup(dirty);
    expect(res.safe).toBe(true);
    expect(res.sanitized).not.toMatch(/<script/i);
    expect(res.sanitized).not.toMatch(/onload/i);
    expect(res.sanitized).not.toMatch(/foreignObject/i);
    expect(res.sanitized).not.toMatch(/javascript:/i);
    expect(res.sanitized).toContain('<circle');
  });

  it('rejects non-svg HTML payloads', () => {
    const res = sanitizeSvgMarkup('<html><body><script>alert(1)</script></body></html>');
    expect(res.safe).toBe(false);
  });
});

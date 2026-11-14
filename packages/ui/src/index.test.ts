import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  Button,
  Card,
  Input,
  PasswordInput,
  Select,
  UI_TOKENS_VERSION,
  cn,
} from './index.js';

describe('@nova/ui', () => {
  it('defines Creative Dark Studio design tokens in tokens.css', () => {
    const css = readFileSync(path.resolve(__dirname, 'tokens.css'), 'utf8');
    expect(css).toContain('color-scheme: dark;');
    expect(css).toContain('--bg-app: #0B0C0F;');
    expect(css).toContain('--bg-panel: #14161B;');
    expect(css).toContain('--accent: #7C5CFF;');
    expect(css).toContain('--accent-2: #22D3EE;');
    expect(css).toContain('dialog:modal');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('merges classes via cn helper', () => {
    expect(UI_TOKENS_VERSION).toBe(1);
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('renders accessible primitives without errors', () => {
    const html = renderToStaticMarkup(
      createElement(Card, {
        children: [
          createElement(Input, { key: 'email', id: 'email', label: 'Email', error: 'Required' }),
          createElement(PasswordInput, { key: 'pw', id: 'pw', label: 'Password' }),
          createElement(Select, {
            key: 'role',
            id: 'role',
            label: 'Role',
            children: createElement('option', { value: 'EDITOR' }, 'Editor'),
          }),
          createElement(Badge, { key: 'badge', variant: 'success', children: 'Synced' }),
          createElement(Button, { key: 'btn', type: 'submit', children: 'Continue' }),
        ],
      }),
    );
    expect(html).toContain('for="email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Show password');
    expect(html).toContain('Synced');
  });
});

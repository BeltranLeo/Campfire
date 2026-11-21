import { describe, expect, it } from 'vitest';
import { langFromUrl, MESSAGES, parseLang } from '../src/web/messages.js';

describe('the interface language', () => {
  it('accepts only English and Spanish', () => {
    expect(parseLang('es')).toBe('es');
    expect(parseLang('en')).toBe('en');
    expect(parseLang('ES')).toBe(null);
    expect(parseLang('pt')).toBe(null);
    expect(parseLang(null)).toBe(null);
  });

  it('reads ?lang= before or inside the hash, the hash winning', () => {
    expect(langFromUrl('?lang=es', '#/')).toBe('es');
    expect(langFromUrl('', '#/welcome?lang=es')).toBe('es');
    expect(langFromUrl('?lang=es', '#/?lang=en')).toBe('en');
    expect(langFromUrl('', '#/offers')).toBe(null);
  });

  it('has every line in Spanish that it has in English', () => {
    const keys = (value: unknown, path = ''): string[] =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${path}.${k}`))
        : [path];
    expect(keys(MESSAGES.es)).toEqual(keys(MESSAGES.en));
    expect(MESSAGES.es.landing.how).toHaveLength(MESSAGES.en.landing.how.length);
  });
});

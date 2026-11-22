import { describe, expect, it } from 'vitest';
import { canonicalMethod, filterOptions, offerTakes, reversibleMethods, reversibleWarning } from '../src/web/paymentMethods';

describe('payment methods', () => {
  it('reads spellings without case, accents, spaces or punctuation', () => {
    expect(canonicalMethod('  transferencia   POR alias ', 'ARS')).toBe('Alias transfer');
    expect(canonicalMethod('Transferéncia bancaria', 'ARS')).toBe('Bank transfer (CBU)');
    expect(canonicalMethod('Apple Pay', 'USD')).toBe('Apple Cash');
    expect(canonicalMethod(' Payoneer ', 'USD')).toBe('Payoneer');
  });

  it('lists the filter options of one currency, or of all without repeats', () => {
    expect(filterOptions('ARS')).toEqual(['Alias transfer', 'Bank transfer (CBU)']);
    const all = filterOptions('');
    expect(all).toContain('Alias transfer');
    expect(all).toContain('Zelle');
    expect(new Set(all).size).toBe(all.length);
  });

  it('matches offers however their author spelled the method', () => {
    expect(offerTakes(['zelle', 'Payoneer'], 'USD', 'Zelle')).toBe(true);
    expect(offerTakes(['Bank transfer'], 'ARS', 'Bank transfer (CBU)')).toBe(true);
    expect(offerTakes(['Bank transfer'], 'USD', 'Bank transfer (CBU)')).toBe(false);
    expect(offerTakes(['simulated'], 'USD', 'Zelle')).toBe(false);
  });

  it('warns only about methods whose payments can be reversed', () => {
    expect(reversibleMethods(['Zelle', 'paypal', 'Venmo'], 'USD')).toEqual(['PayPal', 'Venmo']);
    expect(reversibleWarning(['Zelle', 'Wise'], 'USD')).toBeNull();
    expect(reversibleWarning(['Cash App', 'PayPal', 'Venmo'], 'USD')).toMatch(/^Cash App, PayPal and Venmo payments can be reversed/);
    expect(reversibleWarning(['Alias transfer'], 'ARS')).toBeNull();
  });
});

describe('payment methods as people really type them', () => {
  it('reads a one-letter typo of a long name, never of a short one', () => {
    expect(canonicalMethod('Trasferencia bancaria', 'ARS')).toBe('Bank transfer (CBU)');
    expect(canonicalMethod('Zele', 'USD')).toBe('Zele');
    expect(canonicalMethod('cbv', 'ARS')).toBe('cbv');
  });

  it('finds offers that name the app the money moves through', () => {
    expect(offerTakes(['Mercado pago', 'uala'], 'ARS', 'Alias transfer')).toBe(true);
    expect(offerTakes(['brubank'], 'ARS', 'Bank transfer (CBU)')).toBe(true);
    expect(offerTakes(['brubank'], 'ARS', 'Alias transfer')).toBe(false);
    // Only to find offers: a name typed by hand stays as typed.
    expect(canonicalMethod('Mercado Pago', 'ARS')).toBe('Mercado Pago');
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyMargin,
  describeMargin,
  formatAmount,
  formatBch,
  formatFiat,
  formatPaymentWindow,
  formatRange,
  fromBaseUnits,
  toAmountInput,
} from '../src/web/format.js';

const BCH = { symbol: 'BCH', decimals: 8, isBch: true };
const PUSD = { symbol: 'PUSD', decimals: 2, isBch: false };

describe('web formats', () => {
  it('converts base units exactly', () => {
    expect(fromBaseUnits('1', 2)).toBe('0.01');
    expect(fromBaseUnits('10', 2)).toBe('0.10');
    expect(fromBaseUnits('20000', 2)).toBe('200.00');
    expect(fromBaseUnits('123456789012', 2)).toBe('1,234,567,890.12');
    expect(fromBaseUnits('5', 0)).toBe('5');
    expect(fromBaseUnits(-150n, 2)).toBe('-1.50');
  });

  it('formats amounts in BCH, never sats', () => {
    expect(formatRange('5000', '20000', BCH)).toBe('0.00005 – 0.0002 BCH');
    expect(formatRange('1', '10', PUSD)).toBe('0.01 – 0.10 PUSD');
    expect(formatAmount('251000', BCH)).toBe('0.00251 BCH');
    expect(formatAmount('150000000', BCH)).toBe('1.5 BCH');
    expect(formatAmount('500', PUSD)).toBe('5.00 PUSD');
    expect(formatBch(1000n)).toBe('0.00001 BCH');
    expect(toAmountInput('100000', BCH)).toBe('0.001');
    expect(toAmountInput('10', PUSD)).toBe('0.10');
  });

  it('formats prices with the margin', () => {
    expect(formatFiat(465.123, 'USD')).toBe('465.12 USD');
    expect(formatFiat(493824, 'ARS')).toBe('493,824.00 ARS');
    expect(applyMargin('100', 250)).toBeCloseTo(102.5);
    expect(applyMargin('100', -100)).toBeCloseTo(99);
    expect(describeMargin(0)).toBe('Market price');
    expect(describeMargin(250)).toBe('Market price + 2.5%');
    expect(describeMargin(-100)).toBe('Market price − 1%');
  });

  it('gives the payment window in minutes', () => {
    expect(formatPaymentWindow(300)).toBe('5 min to pay');
    expect(formatPaymentWindow(3600)).toBe('60 min to pay');
  });
});

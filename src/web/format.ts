// Number and date formats used across pages. BCH amounts are always shown in BCH, never in sats.
// No DOM here, so the unit tests in test/format.test.ts can run them under Node. Words come from messages.ts.

import { text } from './messages';

/** Base units (sats, token base units) to a decimal string with exactly `decimals` digits. Exact: no floats. */
export function fromBaseUnits(units: string | bigint, decimals: number): string {
  const value = BigInt(units);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(-decimals)}` : '';
  return `${negative ? '-' : ''}${groupThousands(whole)}${fraction}`;
}

/** A BCH balance from sats, without trailing zeros: 4120000 → "0.0412", 5516 → "0.00005516", 150000000 → "1.5", 0 → "0". */
export function formatBchBalance(sats: bigint): string {
  const [whole, fraction = ''] = fromBaseUnits(sats, 8).split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A BCH amount from sats, for people: 5000 → "0.00005 BCH". The interface never shows sats. */
export function formatBch(sats: string | bigint): string {
  return `${formatBchBalance(BigInt(sats))} BCH`;
}

/** "0.00005 BCH" for BCH; "0.10 PUSD" for a token with its decimals. */
export function formatAmount(units: string | bigint, asset: { symbol: string; decimals: number; isBch: boolean }): string {
  return asset.isBch ? formatBch(units) : `${fromBaseUnits(units, asset.decimals)} ${asset.symbol}`;
}

/** "0.00005 – 0.0002 BCH", "0.01 – 0.10 PUSD". */
export function formatRange(min: string, max: string, asset: { symbol: string; decimals: number; isBch: boolean }): string {
  if (asset.isBch) return `${formatBchBalance(BigInt(min))} – ${formatBchBalance(BigInt(max))} BCH`;
  return `${fromBaseUnits(min, asset.decimals)} – ${fromBaseUnits(max, asset.decimals)} ${asset.symbol}`;
}

/**
 * Base units as the text an amount field starts with: "0.001" for 100000 sats, "0.10" for 10 PUSD cents.
 * Ungrouped, so a field never starts with a comma the person could mistake for a decimal mark.
 */
export function toAmountInput(units: string | bigint, asset: { decimals: number; isBch: boolean }): string {
  return (asset.isBch ? formatBchBalance(BigInt(units)) : fromBaseUnits(units, asset.decimals)).replace(/,/g, '');
}

/** A fiat price with two decimals and the currency after it: "493,824.00 ARS". */
export function formatFiat(value: number, fiat: string): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${fiat}`;
}

/** A fiat amount the protocol computed as a decimal string ("1234.56"), grouped: "1,234.56 ARS". Exact. */
export function formatFiatAmount(decimal: string, fiat: string): string {
  const [whole, fraction] = decimal.split('.');
  return `${groupThousands(whole)}${fraction ? `.${fraction}` : ''} ${fiat}`;
}

/** The oracle price adjusted by the offer's margin in basis points. */
export function applyMargin(price: string, marginBps: number): number {
  return Number(price) * (1 + marginBps / 10_000);
}

/** "Market price", "Market price + 2.5%", "Market price − 1%". */
export function describeMargin(marginBps: number, base = text().common.marketPrice): string {
  if (marginBps === 0) return base;
  const percent = Math.abs(marginBps) / 100;
  return `${base} ${marginBps > 0 ? '+' : '−'} ${percent}%`;
}

/**
 * A payment method as people read it. Offers store the names their author typed; the demo's "simulated"
 * would read like an error on its own.
 */
export function paymentMethodLabel(method: string): string {
  return method === 'simulated' ? text().common.simulatedPayment : method;
}

/** "5 min to pay": the payment window is always given in minutes. */
export function formatPaymentWindow(seconds: number): string {
  return text().common.minToPay(Math.round(seconds / 60));
}

/** "14 Nov" from Unix seconds. */
export function formatDayMonth(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(text().common.dateLocale, { day: 'numeric', month: 'short' });
}

/** "15 Nov 2026" from Unix seconds. */
export function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(text().common.dateLocale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "16 Nov 2026, 14:04" from Unix seconds. */
export function formatDateTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${formatDate(seconds)}, ${formatHourMinute(date)}`;
}

/** "14:04", 24-hour clock. */
export function formatHourMinute(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "04:37" for a countdown; never negative. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "14:01:32", 24-hour clock in the viewer's time zone. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

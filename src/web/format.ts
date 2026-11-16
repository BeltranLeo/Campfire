// Number and date formats used across pages, copied from the design screens. No DOM here,
// so the unit tests in test/format.test.ts can run them under Node.

/** Base units (sats, token base units) to a decimal string with exactly `decimals` digits. Exact: no floats. */
export function fromBaseUnits(units: string | bigint, decimals: number): string {
  const value = BigInt(units);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(-decimals)}` : '';
  return `${negative ? '-' : ''}${groupThousands(whole)}${fraction}`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "5,000 sats" for BCH; "0.10 PUSD" for a token with its decimals. */
export function formatAmount(units: string | bigint, asset: { symbol: string; decimals: number; isBch: boolean }): string {
  return asset.isBch ? `${groupThousands(BigInt(units).toString())} sats` : `${fromBaseUnits(units, asset.decimals)} ${asset.symbol}`;
}

/** "5,000 – 20,000 sats", "0.01 – 0.10 PUSD". */
export function formatRange(min: string, max: string, asset: { symbol: string; decimals: number; isBch: boolean }): string {
  if (asset.isBch) return `${groupThousands(BigInt(min).toString())} – ${groupThousands(BigInt(max).toString())} sats`;
  return `${fromBaseUnits(min, asset.decimals)} – ${fromBaseUnits(max, asset.decimals)} ${asset.symbol}`;
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
export function describeMargin(marginBps: number): string {
  if (marginBps === 0) return 'Market price';
  const percent = Math.abs(marginBps) / 100;
  return `Market price ${marginBps > 0 ? '+' : '−'} ${percent}%`;
}

/** "5 min to pay": the payment window is always given in minutes. */
export function formatPaymentWindow(seconds: number): string {
  return `${Math.round(seconds / 60)} min to pay`;
}

/** "14 Nov" from Unix seconds. */
export function formatDayMonth(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "15 Nov 2026" from Unix seconds. */
export function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "14:01:32", 24-hour clock in the viewer's time zone. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

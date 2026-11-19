// The payment methods Campfire suggests for each currency. Offers store the method's name as people read it (the
// protocol takes any string), so these names are what ends up in published offers. Spellings people type by hand
// ("zelle", "transferencia por alias") are read as the same method, so the offer filter finds them too.

export interface PaymentMethod {
  /** The name stored in the offer and shown everywhere. */
  name: string;
  /** Other ways people write the same method; compared without case, accents, spaces or punctuation. */
  aliases?: readonly string[];
  /**
   * Apps whose accounts take this method, only for finding offers: an offer that names "Mercado Pago" pays and gets
   * paid by alias transfer. Unlike aliases, a name typed in "Other" is kept as typed.
   */
  apps?: readonly string[];
  /** The payer can claw the payment back after the coins are released (chargebacks, disputes). */
  reversible?: boolean;
}

/** How many suggestions show before "More". */
export const VISIBLE_METHODS = 5;

// Most used first: the first VISIBLE_METHODS are on screen, the rest behind "More".
// In Argentina every bank and wallet account takes transfers to its alias, CBU or CVU, so the brand of the app the
// money leaves from does not matter to the seller: what they choose is how they want to be paid.
const METHODS: Record<string, readonly PaymentMethod[]> = {
  ARS: [
    {
      name: 'Alias transfer',
      aliases: ['alias', 'transferencia por alias', 'transferencia a alias', 'cvu', 'transfer to alias'],
      apps: ['Mercado Pago', 'Ualá', 'Naranja X', 'Personal Pay', 'Prex', 'Lemon', 'Belo'],
    },
    { name: 'Bank transfer (CBU)', aliases: ['bank transfer', 'transferencia', 'transferencia bancaria', 'cbu'], apps: ['Brubank'] },
  ],
  USD: [
    { name: 'Zelle' },
    { name: 'Bank transfer (ACH)', aliases: ['bank transfer', 'ach', 'ach transfer', 'transferencia', 'transferencia bancaria'] },
    { name: 'Wise', aliases: ['transferwise'] },
    { name: 'Revolut' },
    { name: 'Cash App', aliases: ['cashapp', 'square cash'], reversible: true },
    { name: 'Venmo', reversible: true },
    { name: 'PayPal', reversible: true },
    { name: 'Apple Cash', aliases: ['apple pay'] },
    { name: 'Chime' },
  ],
};

/** The currencies that have suggestions. */
export const METHOD_FIATS = Object.keys(METHODS);

/** The suggested methods for a currency, most used first; pesos when the currency has none of its own. */
export const methodsFor = (fiat: string): readonly PaymentMethod[] => METHODS[fiat] ?? METHODS.ARS;

/** Lower case, no accents, letters and digits only: "Transferencia por alias" and "transferenciaporalias" match. */
const key = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Whether two keys differ by at most one letter added, removed or changed ("trasferencia" for "transferencia"). */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// Short names are too close to each other for a typo to be read safely ("ach", "cbu", "cvu").
const TYPO_MIN_LENGTH = 6;
const sameKey = (typed: string, known: string) => typed === known || (known.length >= TYPO_MIN_LENGTH && oneEditApart(typed, known));

/** The suggested method a typed name stands for, in this currency; undefined if it is not one of them. */
export function findMethod(name: string, fiat: string): PaymentMethod | undefined {
  const k = key(name);
  if (!k) return undefined;
  const names = (m: PaymentMethod) => [m.name, ...(m.aliases ?? [])].map(key);
  // An exact spelling wins over a typo of another method.
  return methodsFor(fiat).find((m) => names(m).includes(k)) ?? methodsFor(fiat).find((m) => names(m).some((n) => sameKey(k, n)));
}

/** The name as Campfire writes it: "zelle" → "Zelle". A name that is not a suggestion stays as typed. */
export const canonicalMethod = (name: string, fiat: string): string => findMethod(name, fiat)?.name ?? name.trim();

/** Every suggested name, in any currency: they are not "typed by hand" when the currency changes. */
export function isSuggestedAnywhere(name: string): boolean {
  return METHOD_FIATS.some((fiat) => findMethod(name, fiat) !== undefined);
}

/** The methods in the list that let the payer reverse the payment. */
export const reversibleMethods = (names: readonly string[], fiat: string): string[] =>
  names.map((n) => findMethod(n, fiat)).filter((m): m is PaymentMethod => Boolean(m?.reversible)).map((m) => m.name);

/** "PayPal", "PayPal and Venmo", "Cash App, Venmo and PayPal". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The warning for whoever receives a reversible payment; null when no method is reversible. */
export function reversibleWarning(names: readonly string[], fiat: string): string | null {
  const reversible = reversibleMethods(names, fiat);
  if (reversible.length === 0) return null;
  return `${joinNames(reversible)} payments can be reversed after the coins are released. Only accept them from people you trust.`;
}

/** The options of the offer filter: the suggestions of one currency, or of every currency when none is chosen. */
export function filterOptions(fiat: string): string[] {
  const fiats = fiat ? [fiat] : METHOD_FIATS;
  const names: string[] = [];
  for (const f of fiats) for (const m of methodsFor(f)) if (!names.includes(m.name)) names.push(m.name);
  return names;
}

/** Whether an offer in `fiat` takes the method chosen in the filter, however its author wrote it. */
export function offerTakes(paymentMethods: readonly string[], fiat: string, method: string): boolean {
  const chosen = methodsFor(fiat).find((m) => m.name === method);
  const apps = (chosen?.apps ?? []).map(key);
  return paymentMethods.some((m) => canonicalMethod(m, fiat) === method || apps.some((app) => sameKey(key(m), app)));
}

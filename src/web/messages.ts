// Interface text in each language. The site's frame (nav, footer, the connect button) and the shared bits live here;
// each translated page has its own file in i18n/, merged below. Pages not listed are still English only. `es` must have the same shape as `en`, so TypeScript
// catches a missing or misnamed line. Spanish is neutral (no regional slang) and speaks to the person as «tú».
// Never put here anything that is signed, hashed or stored in an offer: those words stay as they are in every language.
// No DOM here, so test/lang.test.ts can check both languages under Node; the language switch is in lang.ts.

import { offers } from './i18n/offers';
import { take } from './i18n/take';
import { trade } from './i18n/trade';
import { tradePage } from './i18n/tradePage';
import { seller } from './i18n/seller';
import { chat } from './i18n/chat';

export type Lang = 'en' | 'es';

/** A stored or linked value: only "en" and "es" count; anything else means no choice. */
export function parseLang(raw: string | null | undefined): Lang | null {
  return raw === 'en' || raw === 'es' ? raw : null;
}

/**
 * The ?lang= of a link. With hash routing it can sit before the hash (campfire.cash/?lang=es#/) or inside it
 * (campfire.cash/#/welcome?lang=es); the one inside the hash wins.
 */
export function langFromUrl(search: string, hash: string): Lang | null {
  const inHash = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  return parseLang(new URLSearchParams(inHash).get('lang')) ?? parseLang(new URLSearchParams(search).get('lang'));
}

const en = {
  nav: {
    label: 'Main',
    logo: 'Campfire, home',
    home: 'Home',
    offers: 'Offers',
    trades: 'Trades',
    chats: 'Chats',
    about: 'How it works',
    transparency: 'Transparency',
  },
  footer: {
    vote: 'Vote for Campfire with CashTokens',
    spec: 'Protocol spec',
    roadmap: 'Roadmap',
    mainnet: 'Mainnet. Real funds.',
    theme: 'Theme',
    themeSystem: 'System theme',
    themeLight: 'Light theme',
    themeDark: 'Dark theme',
    language: 'Language',
    advanced: 'Show technical details',
    advancedHint: 'Transactions, keys and addresses, open on every screen',
  },
  wallet: {
    connect: 'Connect wallet',
    // The phone header shares one row with the nav, so the button says less there.
    connectShort: 'Connect',
    showBalance: 'Show balance',
    hideBalance: 'Hide balance',
  },
  common: {
    copy: 'Copy',
    copied: 'Copied',
    tryAgain: 'Try again',
    onChain: 'On-chain',
    simulated: 'Simulated',
    offChain: 'Off-chain',
    onChainDetails: 'On-chain details',
    openInExplorer: (value: string) => `${value}, open in block explorer`,
    simulatedPayment: 'Simulated payment',
    minToPay: (minutes: number) => `${minutes} min to pay`,
    buy: 'Buy',
    sell: 'Sell',
    marketPrice: 'Market price',
    // Dates read "15 Nov 2026" in English and "15 nov 2026" in Spanish; times are 24-hour in both.
    dateLocale: 'en-GB',
    // "Cash App, PayPal and Venmo".
    and: 'and',
    noWallet: 'No wallet yet? Your coins go to your own wallet.',
    getOneFirst: 'Get one first',
    findingFreshAddress: 'Finding a fresh address of your wallet…',
    findingAddresses: 'Finding your addresses…',
    readingBalance: (percent: number) => `Reading your balance… ${percent}%`,
    reversible: (methods: string) =>
      `${methods} payments can be reversed after the coins are released. Only accept them from people you trust.`,
    whatIs: (word: string) => `What does ${word} mean?`,
    glossary: {
      arbiter: 'A neutral person who decides only if there is a dispute. They can choose who gets the BCH, but can never take it.',
      'on-chain': 'Written on the Bitcoin Cash network, where anyone can check it. Campfire cannot change it.',
    },
  },
  offers: offers.en,
  balanceLoading: {
    findingTitle: 'Finding your wallet’s addresses…',
    findingCount: (n: number) => (n > 0 ? `${n.toLocaleString('en-US')} checked so far` : ''),
    readingTitle: 'Reading your balance from the network…',
    readingCount: (done: number, total: number) => `${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} addresses`,
    why: 'Your wallet keeps its coins on many addresses. Campfire asks the network about each one and adds them up.',
    soFar: 'found so far',
    left: (seconds: number) => (seconds < 60 ? `about ${Math.max(5, Math.round(seconds / 5) * 5)} s left` : `about ${Math.round(seconds / 60)} min left`),
    almostDone: 'almost done',
    percent: (n: number) => `${n}%`,
  },
  take: take.en,
  trade: trade.en,
  tradePage: tradePage.en,
  seller: seller.en,
  chat: chat.en,
  landing: {
    title: 'Buy or sell Bitcoin Cash directly with another person',
    lead: 'No exchange holds your money. A contract on the Bitcoin Cash network locks the seller’s coins until the payment is done.',
    buy: 'I want to buy BCH',
    buyHint: 'You don’t need any BCH to start',
    sell: 'I want to sell BCH',
    sellHint: 'Get paid in your local currency',
    newcomer: 'New to Bitcoin Cash?',
    getWallet: 'Get a free wallet in 2 minutes →',
    demoTag: 'Simulated fiat',
    demoLabel: 'Try a trade without spending anything',
    demoBody:
      'A demo seller sends a few cents of real BCH to your wallet. The payment step is simulated: you send no money. It takes about three minutes.',
    demoButton: 'Try the demo trade',
    howTitle: 'How it works',
    how: [
      { title: 'Pick an offer, or post your own', body: 'Choose how much, and how you want to pay or get paid.' },
      {
        title: 'The seller’s coins get locked',
        body: 'A contract holds them. They can only go to the buyer or back to the seller. Campfire cannot touch them.',
      },
      {
        title: 'Pay, then receive',
        body: 'The buyer pays the seller directly. When the seller confirms, the coins go to the buyer’s wallet.',
      },
    ],
    safeSummary: 'Why it’s safe and fast',
    safeTag: '0-conf with DSProofs',
    safeLead:
      'On Bitcoin Cash a payment can be trusted seconds after it reaches the network, not ten minutes later. Campfire relies on that for every trade, and checks it in your browser.',
    safe: (seconds: number) => [
      {
        title: 'The deposit is seen in seconds',
        body: 'When the seller locks the coins, the transaction reaches every node almost at once. It is not in a block yet: that is zero confirmations, or 0-conf.',
      },
      {
        title: 'Double spends are caught',
        body: 'If anyone tries to spend the same coins twice, Bitcoin Cash nodes broadcast a double-spend proof (DSProof) within seconds. Your browser asks for one.',
      },
      {
        title: 'No proof, go ahead',
        body: `After ${seconds} quiet seconds the deposit is safe to act on, so you can pay. The coins you receive are usable right away too.`,
      },
    ],
    latest: 'Latest offers',
    seeAll: 'See all offers',
    // A sell offer is where the visitor buys, so the row says what *they* do.
    youBuy: (symbol: string) => `You buy ${symbol}`,
    youSell: (symbol: string) => `You sell ${symbol}`,
    buyButton: 'Buy',
    sellButton: 'Sell',
    payFiat: (fiat: string) => `pay ${fiat}`,
    getFiat: (fiat: string) => `get ${fiat}`,
    simulatedPayment: 'Simulated payment',
    statsTitle: 'Campfire so far',
    statsTag: 'Counted from mainnet',
    tradesCompleted: (n: number): string => (n === 1 ? 'trade completed' : 'trades completed'),
    traded: 'traded through the contract',
    openOffers: 'offers open now',
    proofBefore: 'Every number comes from real transactions you can ',
    proofLink: 'check yourself',
    proofAfter: '.',
    mostlyDemo: ' Most trades so far are demo trades, where the payment is simulated.',
  },
  welcome: {
    step: (step: number, of: number) => `Step ${step} of ${of}`,
    back: 'Back',
    title: 'Your BCH goes to your own wallet',
    lead: 'A wallet is a free app on your phone. Only you control it: Campfire never holds your money.',
    haveOne: 'I already have a wallet',
    haveOneHint: 'Selene or Paytaca',
    getOne: 'Get a free wallet',
    walletNotes: {
      Selene: 'A Bitcoin Cash wallet for your phone.',
      Paytaca: 'A Bitcoin Cash wallet for your phone or browser.',
    } as Record<string, string>,
    getIt: 'Get it',
    afterInstall: 'Install it, create a wallet, write down the recovery words, and come back here.',
    haveItNow: 'I have it now',
    connectTitle: 'Connect your wallet',
    connect: 'Connect my wallet',
    noSignature: 'Connecting needs no signature',
  },
};

export type Messages = typeof en;

const es: Messages = {
  nav: {
    label: 'Principal',
    logo: 'Campfire, inicio',
    home: 'Inicio',
    offers: 'Ofertas',
    trades: 'Operaciones',
    chats: 'Chats',
    about: 'Cómo funciona',
    transparency: 'Transparencia',
  },
  footer: {
    vote: 'Vota por Campfire con CashTokens',
    spec: 'Especificación del protocolo',
    roadmap: 'Hoja de ruta',
    mainnet: 'Mainnet. Fondos reales.',
    theme: 'Tema',
    themeSystem: 'Tema del sistema',
    themeLight: 'Tema claro',
    themeDark: 'Tema oscuro',
    language: 'Idioma',
    advanced: 'Mostrar detalles técnicos',
    advancedHint: 'Transacciones, claves y direcciones, abiertas en cada pantalla',
  },
  wallet: {
    connect: 'Conectar billetera',
    connectShort: 'Conectar',
    showBalance: 'Mostrar saldo',
    hideBalance: 'Ocultar saldo',
  },
  common: {
    copy: 'Copiar',
    copied: 'Copiado',
    tryAgain: 'Reintentar',
    onChain: 'En la cadena',
    simulated: 'Simulado',
    offChain: 'Fuera de la cadena',
    onChainDetails: 'Detalles en la cadena',
    openInExplorer: (value: string) => `${value}, abrir en el explorador de bloques`,
    simulatedPayment: 'Pago simulado',
    minToPay: (minutes: number) => `${minutes} min para pagar`,
    buy: 'Comprar',
    sell: 'Vender',
    marketPrice: 'Precio de mercado',
    dateLocale: 'es',
    and: 'y',
    noWallet: '¿Todavía no tienes billetera? Tus monedas van a tu propia billetera.',
    getOneFirst: 'Consigue una primero',
    findingFreshAddress: 'Buscando una dirección nueva de tu billetera…',
    findingAddresses: 'Buscando tus direcciones…',
    readingBalance: (percent) => `Leyendo tu saldo… ${percent}\u00a0%`,
    reversible: (methods) =>
      `Los pagos con ${methods} se pueden revertir después de liberar las monedas. Acéptalos solo de personas de confianza.`,
    whatIs: (word) => `¿Qué significa «${word}»?`,
    glossary: {
      arbiter: 'Una persona neutral que decide solo si hay una disputa. Puede elegir quién recibe los BCH, pero nunca quedárselos.',
      'on-chain': 'Escrito en la red de Bitcoin Cash, donde cualquiera puede comprobarlo. Campfire no puede cambiarlo.',
    },
  },
  offers: offers.es,
  balanceLoading: {
    findingTitle: 'Buscando las direcciones de tu billetera…',
    findingCount: (n: number) => (n > 0 ? `${n.toLocaleString('es')} revisadas hasta ahora` : ''),
    readingTitle: 'Leyendo tu saldo desde la red…',
    readingCount: (done: number, total: number) => `${done.toLocaleString('es')} de ${total.toLocaleString('es')} direcciones`,
    why: 'Tu billetera guarda sus monedas en muchas direcciones. Campfire le pregunta a la red por cada una y las suma.',
    soFar: 'encontrados hasta ahora',
    left: (seconds: number) => (seconds < 60 ? `faltan unos ${Math.max(5, Math.round(seconds / 5) * 5)} s` : `faltan unos ${Math.round(seconds / 60)} min`),
    almostDone: 'casi listo',
    // The RAE puts a space before %, a non-breaking one so it never ends up alone on a line.
    percent: (n: number) => `${n}\u00a0%`,
  },
  take: take.es,
  trade: trade.es,
  tradePage: tradePage.es,
  seller: seller.es,
  chat: chat.es,
  landing: {
    title: 'Compra o vende Bitcoin Cash directamente con otra persona',
    lead: 'Ninguna plataforma guarda tu dinero. Un contrato en la red de Bitcoin Cash bloquea las monedas del vendedor hasta que se completa el pago.',
    buy: 'Quiero comprar BCH',
    buyHint: 'No necesitas tener BCH para empezar',
    sell: 'Quiero vender BCH',
    sellHint: 'Cobra en tu moneda local',
    newcomer: '¿Primera vez con Bitcoin Cash?',
    getWallet: 'Consigue una billetera gratis en 2 minutos →',
    demoTag: 'Dinero simulado',
    demoLabel: 'Prueba una operación sin gastar nada',
    demoBody:
      'Un vendedor de demostración envía unos centavos de BCH real a tu billetera. El pago es simulado: no envías dinero. Toma unos tres minutos.',
    demoButton: 'Probar la operación de demostración',
    howTitle: 'Cómo funciona',
    how: [
      { title: 'Elige una oferta o publica la tuya', body: 'Elige cuánto, y cómo quieres pagar o cobrar.' },
      {
        title: 'Las monedas del vendedor quedan bloqueadas',
        body: 'Las retiene un contrato. Solo pueden ir al comprador o volver al vendedor. Campfire no puede tocarlas.',
      },
      {
        title: 'Paga y recibe',
        body: 'El comprador le paga directamente al vendedor. Cuando el vendedor lo confirma, las monedas van a la billetera del comprador.',
      },
    ],
    safeSummary: 'Por qué es seguro y rápido',
    safeTag: '0-conf con DSProofs',
    safeLead:
      'En Bitcoin Cash se puede confiar en un pago segundos después de que llega a la red, no diez minutos más tarde. Campfire se apoya en eso en cada operación y lo comprueba en tu navegador.',
    safe: (seconds: number) => [
      {
        title: 'El depósito se ve en segundos',
        body: 'Cuando el vendedor bloquea las monedas, la transacción llega a todos los nodos casi al instante. Todavía no está en un bloque: eso es cero confirmaciones, o 0-conf.',
      },
      {
        title: 'Se detectan los dobles gastos',
        body: 'Si alguien intenta gastar las mismas monedas dos veces, los nodos de Bitcoin Cash difunden una prueba de doble gasto (DSProof) en segundos. Tu navegador la pide.',
      },
      {
        title: 'Sin prueba, adelante',
        body: `Tras ${seconds} segundos sin novedades, el depósito es seguro y puedes pagar. Las monedas que recibes también se pueden usar de inmediato.`,
      },
    ],
    latest: 'Últimas ofertas',
    seeAll: 'Ver todas las ofertas',
    youBuy: (symbol: string) => `Compras ${symbol}`,
    youSell: (symbol: string) => `Vendes ${symbol}`,
    buyButton: 'Comprar',
    sellButton: 'Vender',
    payFiat: (fiat: string) => `pagas en ${fiat}`,
    getFiat: (fiat: string) => `cobras en ${fiat}`,
    simulatedPayment: 'Pago simulado',
    statsTitle: 'Campfire hasta ahora',
    statsTag: 'Contado en mainnet',
    tradesCompleted: (n: number) => (n === 1 ? 'operación completada' : 'operaciones completadas'),
    traded: 'operados con el contrato',
    openOffers: 'ofertas abiertas ahora',
    proofBefore: 'Cada número sale de transacciones reales que ',
    proofLink: 'puedes comprobar',
    proofAfter: '.',
    mostlyDemo: ' Hasta ahora, la mayoría de las operaciones son de demostración, con el pago simulado.',
  },
  welcome: {
    step: (step: number, of: number) => `Paso ${step} de ${of}`,
    back: 'Atrás',
    title: 'Tus BCH van a tu propia billetera',
    lead: 'Una billetera es una aplicación gratuita para tu teléfono. Solo tú la controlas: Campfire nunca guarda tu dinero.',
    haveOne: 'Ya tengo una billetera',
    haveOneHint: 'Selene o Paytaca',
    getOne: 'Consigue una billetera gratis',
    walletNotes: {
      Selene: 'Una billetera de Bitcoin Cash para tu teléfono.',
      Paytaca: 'Una billetera de Bitcoin Cash para tu teléfono o tu navegador.',
    },
    getIt: 'Descargar',
    afterInstall: 'Instálala, crea una billetera, anota las palabras de recuperación y vuelve aquí.',
    haveItNow: 'Ya la tengo',
    connectTitle: 'Conecta tu billetera',
    connect: 'Conectar mi billetera',
    noSignature: 'Conectar no requiere ninguna firma',
  },
};

export const MESSAGES: Record<Lang, Messages> = { en, es };

// The language for code outside components (format.ts, trade.ts…), set by lang.ts. English until then, so the
// unit tests read English. Components that show such text also call useMessages(), which re-renders them on a switch.
let active: Lang = 'en';

export function setActiveLang(lang: Lang): void {
  active = lang;
}

/** The interface text in the current language, for code that is not a component. */
export function text(): Messages {
  return MESSAGES[active];
}

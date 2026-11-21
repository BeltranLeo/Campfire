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
import { create } from './i18n/create';
import { chats } from './i18n/chats';
import { mytrades } from './i18n/mytrades';
import { myoffers } from './i18n/myoffers';
import { home } from './i18n/home';
import { about } from './i18n/about';
import { transparency } from './i18n/transparency';
import { roadmap } from './i18n/roadmap';
import { arbiter } from './i18n/arbiter';

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
  // The WizardConnect pairing dialog. The link is the same string the QR code holds, so a wallet can take either.
  pairing: {
    title: 'Connect your wallet',
    close: 'Close',
    steps: ['Open your wallet app', 'Tap Scan', 'Approve Campfire'],
    qrLabel: 'Pairing QR code',
    linkTitle: 'Or use the link',
    linkHint: 'Paste it into your wallet’s WizardConnect option, or open it if your wallet runs on this computer.',
    copyLink: 'Copy link',
    openInWallet: 'Open in wallet',
    openInCashonize: 'Open in Cashonize',
    qrCopy: 'Pairing QR code. Click to copy the link.',
    qrCopied: 'Link copied',
    phoneHint: 'Open your wallet app on this phone to pair. If it keeps saying it is connecting, come back to this tab.',
    copyPairingLink: 'Copy pairing link',
    showQr: 'Show QR code for another device',
    waiting: 'Waiting for the wallet…',
    slowPhone: 'Nothing yet? Make sure the wallet app is open, then try again.',
    slowDesktop: 'Nothing yet? Make sure the wallet app is open, then scan again.',
    privacy:
      'Connecting is your only sign-in. Campfire sees public keys, never private keys, and the wallet asks you before every transaction.',
  },
  // The header button while connecting, and the sign-in dialog that follows the pairing.
  signIn: {
    pairing: 'Pairing…',
    approving: 'Approve in your wallet…',
    needed: 'Sign-in needed',
    connecting: 'Connecting…',
    label: 'Sign in',
    title: 'Approve the sign-in in your wallet',
    failedTitle: 'Your wallet did not approve the sign-in',
    failed: 'The request was declined or timed out. Ask again and approve it in your wallet, or cancel to disconnect.',
    intro:
      'Your wallet is paired. To finish, it asks you to sign once, which proves the wallet is yours so nobody else can trade under your name.',
    steps: ['Open your wallet app', 'Review the Campfire sign-in request', 'Approve it, then come back here'],
    freeTitle: 'Free, and moves no funds',
    free: 'Your wallet may show it as a transaction. It spends a coin that does not exist, so it can never be broadcast and nothing leaves your wallet.',
    retry: 'Ask my wallet again',
    waiting: 'Waiting for your approval…',
    cancel: 'Cancel and disconnect',
    once: 'You sign once on this browser. Later visits reuse it.',
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
      oracle: 'A service that signs the market price when a trade starts, so neither side can change it later. The offer names which one.',
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
  create: create.en,
  chats: chats.en,
  mytrades: mytrades.en,
  myoffers: myoffers.en,
  home: home.en,
  about: about.en,
  transparency: transparency.en,
  roadmap: roadmap.en,
  arbiter: arbiter.en,
  landing: {
    title: 'Buy or sell Bitcoin Cash and PUSD directly with another person',
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
    whyTitle: 'Why Campfire',
    why: [
      {
        title: 'Nobody else can touch the coins',
        body: 'A contract locks the seller’s coins. They can only go to the buyer or back to the seller.',
      },
      {
        title: 'Start with no BCH',
        body: 'Taking an offer is free. You can even post a buy offer with just a wallet: Campfire pays the fee to publish it.',
      },
      {
        title: 'Your keys stay in your wallet',
        body: 'Connect Selene or Paytaca with WizardConnect. Campfire sees public keys only, and you sign every transaction.',
      },
      {
        title: 'Private by design',
        body: 'Payment details and the chat are end-to-end encrypted. The arbiter can read the chat only if one of you opens a dispute.',
      },
      {
        title: 'Offers live on Bitcoin Cash',
        body: 'Each offer is published on the chain with a CashTokens NFT. A contract with no key mints it, one per offer and only if it matches the offer’s terms, so anyone can check it.',
      },
      {
        title: 'Choose your arbiter',
        body: 'Every offer names its arbiter and its price oracle. The protocol is open, so anyone can run one.',
      },
    ] as { title: string; body: string }[],
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
  pairing: {
    title: 'Conecta tu billetera',
    close: 'Cerrar',
    steps: ['Abre la aplicación de tu billetera', 'Toca «Escanear»', 'Aprueba Campfire'],
    qrLabel: 'Código QR para emparejar',
    linkTitle: 'O usa el enlace',
    linkHint: 'Pégalo en la opción WizardConnect de tu billetera, o ábrelo si tu billetera está en esta computadora.',
    copyLink: 'Copiar enlace',
    openInWallet: 'Abrir en la billetera',
    openInCashonize: 'Abrir en Cashonize',
    qrCopy: 'Código QR para emparejar. Haz clic para copiar el enlace.',
    qrCopied: 'Enlace copiado',
    phoneHint:
      'Abre la aplicación de tu billetera en este teléfono para emparejarla. Si se queda en «Conectando», vuelve a esta pestaña.',
    copyPairingLink: 'Copiar enlace de emparejamiento',
    showQr: 'Mostrar código QR para otro dispositivo',
    waiting: 'Esperando a la billetera…',
    slowPhone: '¿Todavía nada? Asegúrate de que la aplicación de la billetera esté abierta y vuelve a intentarlo.',
    slowDesktop: '¿Todavía nada? Asegúrate de que la aplicación de la billetera esté abierta y vuelve a escanear.',
    privacy:
      'Conectar la billetera es tu único inicio de sesión. Campfire ve claves públicas, nunca las privadas, y la billetera te pregunta antes de cada transacción.',
  },
  signIn: {
    pairing: 'Emparejando…',
    approving: 'Aprueba en tu billetera…',
    needed: 'Falta iniciar sesión',
    connecting: 'Conectando…',
    label: 'Iniciar sesión',
    title: 'Aprueba el inicio de sesión en tu billetera',
    failedTitle: 'Tu billetera no aprobó el inicio de sesión',
    failed:
      'La solicitud se rechazó o se agotó el tiempo. Pídela de nuevo y apruébala en tu billetera, o cancela para desconectarte.',
    intro:
      'Tu billetera ya está emparejada. Para terminar, te pide firmar una vez: así se comprueba que la billetera es tuya y nadie más puede operar con tu nombre.',
    steps: ['Abre la aplicación de tu billetera', 'Revisa la solicitud de inicio de sesión de Campfire', 'Apruébala y vuelve aquí'],
    freeTitle: 'Gratis y sin mover fondos',
    free: 'Puede que tu billetera la muestre como una transacción. Gasta una moneda que no existe, así que nunca puede transmitirse y nada sale de tu billetera.',
    retry: 'Pedírselo de nuevo a mi billetera',
    waiting: 'Esperando tu aprobación…',
    cancel: 'Cancelar y desconectar',
    once: 'Firmas una sola vez en este navegador. Las próximas visitas la reutilizan.',
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
      oracle: 'Un servicio que firma el precio de mercado al empezar la operación, para que ninguna de las partes pueda cambiarlo después. La oferta dice cuál.',
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
  create: create.es,
  chats: chats.es,
  mytrades: mytrades.es,
  myoffers: myoffers.es,
  home: home.es,
  about: about.es,
  transparency: transparency.es,
  roadmap: roadmap.es,
  arbiter: arbiter.es,
  landing: {
    title: 'Compra o vende Bitcoin Cash y PUSD directamente con otra persona',
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
    whyTitle: 'Por qué Campfire',
    why: [
      {
        title: 'Nadie más puede tocar las monedas',
        body: 'Un contrato bloquea las monedas del vendedor. Solo pueden ir al comprador o volver al vendedor.',
      },
      {
        title: 'Empieza sin BCH',
        body: 'Tomar una oferta es gratis. Hasta puedes publicar una oferta de compra solo con una billetera: Campfire paga la comisión para publicarla.',
      },
      {
        title: 'Tus claves quedan en tu billetera',
        body: 'Conecta Selene o Paytaca con WizardConnect. Campfire solo ve claves públicas, y tú firmas cada transacción.',
      },
      {
        title: 'Privado desde el diseño',
        body: 'Los datos de pago y el chat están cifrados de punta a punta. El árbitro puede leer el chat solo si uno de los dos abre una disputa.',
      },
      {
        title: 'Las ofertas viven en Bitcoin Cash',
        body: 'Cada oferta se publica en la cadena con un NFT de CashTokens. Lo acuña un contrato sin clave, uno por oferta y solo si coincide con sus condiciones, así que cualquiera puede comprobarla.',
      },
      {
        title: 'Elige tu árbitro',
        body: 'Cada oferta nombra a su árbitro y a su oráculo de precios. El protocolo es abierto, así que cualquiera puede ofrecerse como uno.',
      },
    ],
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

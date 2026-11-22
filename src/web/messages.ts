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
    slides: 'Pitch slides',
    roadmap: 'Roadmap',
    mainnet: 'Mainnet. Real funds.',
    language: 'Language',
    advanced: 'Show technical details',
    advancedHint: 'Transactions, keys and addresses, open on every screen',
    alerts: 'Alerts',
    alertsOn: 'Sound and notifications when it is your turn: on',
    alertsOff: 'Sound and notifications when it is your turn: off',
    alertsAsk: 'Sound on when it is your turn. Click to get system notifications too',
  },
  wallet: {
    connect: 'Connect wallet',
    // The phone header shares one row with the nav, so the button says less there.
    connectShort: 'Connect',
    showBalance: 'Show balance',
    hideBalance: 'Hide balance',
    // The wallet menu.
    balance: 'Balance',
    balanceFailed: 'Could not read it. Trading still works.',
    tryAgain: 'Try again',
    nameQuestion: 'Where does this name come from?',
    nameAnswer: 'The name others see on your offers and trades. It comes from your wallet, so it never changes and nobody can pick it.',
    bought: (_n: number) => ' bought',
    sold: (_n: number) => ' sold',
    since: (date: string) => ` · since ${date}`,
    noTrades: 'No trades yet',
    countedByCampfire: 'Counted by Campfire, not verifiable on-chain.',
    myTrades: 'My trades',
    myTradesActive: (n: number) => `My trades · ${n} active`,
    disconnect: 'Disconnect',
    // Shown under the header when pairing fails or the service cannot load the wallet.
    timeoutTitle: 'The wallet did not answer',
    timeoutBody: 'Pairing timed out after 2 minutes. Open the wallet and try again.',
    loadTitle: 'Campfire could not load your wallet',
    loadBody: 'Something went wrong. Reload the page to try again.',
  },
  // In-app toasts and nav counters. Invented copy: the design has no notifications.
  notify: {
    request: 'New request',
    turn: 'Your turn',
    dispute: 'Dispute',
    message: 'New message',
    ended: 'Trade ended',
    disputeBy: (other: 'buyer' | 'seller') => `The ${other} opened a dispute`,
    unreadFrom: (n: number, other: 'buyer' | 'seller') => (n > 1 ? `${n} unread messages from the ${other}` : `The ${other} sent you a message`),
    released: 'Completed: the coins were released to the buyer',
    resolvedBuyer: 'The arbiter decided for the buyer',
    resolvedSeller: 'The arbiter decided for the seller',
    paymentWindowEnded: 'The payment window ended; the coins went back to the seller',
    refunded: 'The coins went back to the seller after the refund time',
    cancelled: 'The buyer cancelled the trade',
    endedEarly: 'The trade ended before the coins were locked',
    waitingForYou: ' waiting for you',
    unread: ' unread',
    dismiss: 'Dismiss',
  },
  notFound: {
    title: 'Page not found',
    body: 'This link does not lead to any page on Campfire.',
    home: 'Go to the start page',
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
    comeBack: 'Approved in the wallet? Come back to this tab: the connection finishes here, and only while this tab is in view.',
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
    // Campfire's suggested methods (paymentMethods.ts) as shown on screen. Offers store the English name, so only the
    // label changes with the language and the offer filter keeps finding them.
    methodNames: {
      'Alias transfer': 'Alias transfer',
      'Bank transfer (CBU)': 'Bank transfer (CBU)',
      'Bank transfer (ACH)': 'Bank transfer (ACH)',
    } as Record<string, string>,
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
    noSignature: 'Signs once in this browser, for free. No funds move',
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
    slides: 'Diapositivas del pitch',
    roadmap: 'Hoja de ruta',
    mainnet: 'Mainnet. Fondos reales.',
    language: 'Idioma',
    advanced: 'Mostrar detalles técnicos',
    advancedHint: 'Transacciones, claves y direcciones, abiertas en cada pantalla',
    alerts: 'Avisos',
    alertsOn: 'Sonido y notificaciones cuando te toca: activados',
    alertsOff: 'Sonido y notificaciones cuando te toca: desactivados',
    alertsAsk: 'Sonido activado cuando te toca. Haz clic para recibir también notificaciones del sistema',
  },
  wallet: {
    connect: 'Conectar billetera',
    connectShort: 'Conectar',
    showBalance: 'Mostrar saldo',
    hideBalance: 'Ocultar saldo',
    balance: 'Saldo',
    balanceFailed: 'No se pudo leer. Igual puedes operar.',
    tryAgain: 'Reintentar',
    nameQuestion: '¿De dónde sale este nombre?',
    nameAnswer: 'Es el nombre que otros ven en tus ofertas y operaciones. Sale de tu billetera, así que nunca cambia y nadie puede elegirlo.',
    bought: (n) => (n === 1 ? ' compra' : ' compras'),
    sold: (n) => (n === 1 ? ' venta' : ' ventas'),
    since: (date) => ` · desde el ${date}`,
    noTrades: 'Todavía no tienes operaciones',
    countedByCampfire: 'Lo cuenta Campfire; no se puede comprobar en la cadena.',
    myTrades: 'Mis operaciones',
    myTradesActive: (n) => `Mis operaciones · ${n} ${n === 1 ? 'activa' : 'activas'}`,
    disconnect: 'Desconectar',
    timeoutTitle: 'La billetera no respondió',
    timeoutBody: 'Pasaron 2 minutos sin respuesta. Abre la billetera y vuelve a intentarlo.',
    loadTitle: 'Campfire no pudo cargar tu billetera',
    loadBody: 'Algo salió mal. Recarga la página para volver a intentarlo.',
  },
  notify: {
    request: 'Nueva solicitud',
    turn: 'Te toca',
    dispute: 'Disputa',
    message: 'Mensaje nuevo',
    ended: 'Operación terminada',
    disputeBy: (other) => (other === 'buyer' ? 'El comprador abrió una disputa' : 'El vendedor abrió una disputa'),
    unreadFrom: (n, other) =>
      n > 1
        ? `${n} mensajes sin leer del ${other === 'buyer' ? 'comprador' : 'vendedor'}`
        : `El ${other === 'buyer' ? 'comprador' : 'vendedor'} te envió un mensaje`,
    released: 'Completada: las monedas se liberaron al comprador',
    resolvedBuyer: 'El árbitro decidió a favor del comprador',
    resolvedSeller: 'El árbitro decidió a favor del vendedor',
    paymentWindowEnded: 'Terminó el plazo de pago; las monedas volvieron al vendedor',
    refunded: 'Las monedas volvieron al vendedor al cumplirse el plazo de devolución',
    cancelled: 'El comprador canceló la operación',
    endedEarly: 'La operación terminó antes de que se bloquearan las monedas',
    waitingForYou: ' esperan tu respuesta',
    unread: ' sin leer',
    dismiss: 'Cerrar',
  },
  notFound: {
    title: 'No encontramos esta página',
    body: 'Este enlace no lleva a ninguna página de Campfire.',
    home: 'Ir al inicio',
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
    comeBack: '¿Ya aprobaste en la billetera? Vuelve a esta pestaña: la conexión termina aquí, y solo mientras la pestaña está a la vista.',
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
    methodNames: {
      'Alias transfer': 'Transferencia a alias',
      'Bank transfer (CBU)': 'Transferencia bancaria (CBU)',
      'Bank transfer (ACH)': 'Transferencia bancaria (ACH)',
    },
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
    noSignature: 'Se firma una vez en este navegador, gratis. No mueve fondos',
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

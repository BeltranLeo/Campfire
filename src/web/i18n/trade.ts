// The trade's model in words (trade.ts): title, progress steps and the story of the trade. Whoever reads it is the
// buyer (`you`), the seller (`mine`) or a visitor (neither). `es` must have the shape of `en`; messages.ts checks it.
// The English lines are checked word for word by test/trade.test.ts.

/** Who reads the story: the buyer, the seller, or neither (a visitor or the arbiter). */
export interface Viewer {
  you: boolean;
  mine: boolean;
}

const en = {
  lockedCoins: (isBch: boolean): string => (isBch ? 'the BCH' : 'the coins'),
  buyerSteps: ['Confirm', 'Lock', 'Pay', 'Receive'] as readonly string[],
  sellerSteps: ['Accept', 'Lock', 'Paid', 'Release'] as readonly string[],
  title: (role: 'buyer' | 'seller' | 'visitor', done: boolean, amount: string, fiat: string): string => {
    const what = `${amount} for ${fiat}`;
    if (role === 'visitor') return what;
    if (role === 'seller') return done ? `Sold ${what}` : `Sell ${what}`;
    return done ? `Bought ${what}` : `Buy ${what}`;
  },
  // Step 1
  answeredBuyOffer: (v: Viewer): string =>
    v.mine ? 'You answered the buyer’s offer' : v.you ? 'A seller answered your offer' : 'A seller answered the buy offer',
  tookOffer: (v: Viewer): string => (v.mine ? 'Buyer took your offer' : `${v.you ? 'You' : 'Buyer'} took the offer`),
  // Step 2
  locked: (v: Viewer, coins: string): string => (v.mine ? `You locked ${coins}` : `Seller locked ${coins}`),
  acceptThenLock: (v: Viewer, coins: string): string =>
    v.you ? `You accept, then the seller locks ${coins}` : v.mine ? `Buyer accepts, then you lock ${coins}` : `Buyer accepts, then the seller locks ${coins}`,
  acceptWindow: 'Up to 10 min to accept, then 30 min to lock',
  buyerAcceptedYouLock: (coins: string): string => `Buyer accepted. You lock ${coins}`,
  lockingWindow: 'Locking window: 30 min',
  accepted: (v: Viewer): string => (v.you || v.mine ? 'You accepted' : 'Buyer accepted'),
  sellerLocks: (coins: string): string => `Seller locks ${coins}`,
  lockWindow: 'Up to 30 min to lock',
  notAccepted: (v: Viewer): string => (v.you ? 'You did not accept the request' : 'The buyer did not accept'),
  notLocked: (v: Viewer, coins: string): string => (v.mine ? `You did not lock ${coins} in time` : `The seller did not lock ${coins} in time`),
  detailsEncrypted: 'Payment details encrypted for the buyer',
  youLock: (coins: string): string => `You lock ${coins}`,
  acceptAndLock: (v: Viewer, coins: string): string => (v.mine ? `You accept and lock ${coins}` : `Seller accepts and locks ${coins}`),
  dropped: 'The trade was dropped',
  notAcceptedAndLocked: (coins: string): string => `The seller did not accept and lock ${coins} in time`,
  // Step 3
  pays: (v: Viewer): string => (v.you ? 'You send the payment and mark it as paid' : 'Buyer sends the payment and marks it as paid'),
  markedPaid: (v: Viewer): string => `${v.you ? 'You' : 'Buyer'} marked the payment as sent`,
  windowEnded: 'Payment window ended without a payment',
  notMarked: (v: Viewer): string => `${v.you ? 'You' : 'Buyer'} had not marked the payment as sent`,
  disputeFirst: 'The dispute was opened first',
  paymentWindow: (minutes: number): string => `Payment window: ${minutes} min`,
  // The dispute
  disputeOpened: (v: Viewer, by: 'buyer' | 'seller' | undefined): string => {
    if (!by) return 'Dispute opened';
    const who = by === 'seller' ? (v.mine ? 'you' : 'the seller') : v.you ? 'you' : 'the buyer';
    return `Dispute opened by ${who}`;
  },
  waitingArbiter: 'Waiting for the arbiter',
  // Step 4, or the ending
  release: (v: Viewer, amount: string): string =>
    v.mine ? 'You confirm the payment and release' : `Seller releases ${amount} ${v.you ? 'to your wallet' : 'to the buyer'}`,
  arbiterDecides: 'Arbiter decides: funds go to buyer or seller',
  released: (v: Viewer, amount: string): string =>
    `${v.mine ? 'You released' : 'Seller released'} ${amount} ${v.you ? 'to your wallet' : 'to the buyer'}`,
  arbiterReleased: (v: Viewer, amount: string): string => `Arbiter released ${amount} ${v.you ? 'to your wallet' : 'to the buyer'}`,
  arbiterReturned: (v: Viewer, amount: string): string => `Arbiter returned ${amount} to ${v.mine ? 'you' : 'the seller'}`,
  cancelled: (v: Viewer, amount: string): string =>
    `${v.you ? 'You' : 'Buyer'} cancelled: ${amount} went back to ${v.mine ? 'you' : 'the seller'}`,
  refunded: (v: Viewer, amount: string): string => `${v.mine ? 'You' : 'The seller'} recovered ${amount} after the refund time`,
  // Refusals
  noDeposit: 'There is no deposit to cancel yet.',
  wrongWallet: 'This wallet is not the one that took this trade. Connect the wallet you used to take it.',
  depositNotVisible: 'The deposit is not visible on-chain yet. Try again in a moment.',
  notBuyOffer: 'This request is not for a buy offer.',
  outsideRange: 'The amount is outside the range of your offer.',
  otherArbiter: 'The request names a different arbiter than your offer.',
  otherOracle: "The price is not signed by your offer's oracle.",
  noSignedPrice: 'The request has no signed price.',
  fiatMismatch: 'The amount to pay does not match the price.',
  // The state pill (components/StatusPill.tsx)
  pill: {
    waitingYou: 'Waiting for you',
    waitingBuyer: 'Waiting for buyer',
    waitingSeller: 'Waiting for seller',
    waitingYourDeposit: 'Waiting for your deposit',
    waitingDeposit: 'Waiting for deposit',
    waitingYourPayment: 'Waiting for your payment',
    waitingPayment: 'Waiting for payment',
    waitingYourRelease: 'Paid, waiting for your release',
    waitingRelease: 'Paid, waiting for release',
    inDispute: 'In dispute',
    completed: 'Completed',
    resolvedBuyer: 'Resolved for buyer',
    resolvedSeller: 'Resolved for seller',
    returned: 'Returned to seller',
    cancelled: 'Cancelled',
  },
  // The action card, the timeline and the dispute form
  turnYou: 'Your turn',
  turnOther: 'Waiting',
  turnArbiter: 'Paused · In dispute',
  progressLabel: 'Trade progress',
  simulatedFiat: 'Simulated fiat',
  confirmations: (n: number): string => (n === 0 ? 'in the mempool (0-conf)' : `${n} confirmation${n === 1 ? '' : 's'}`),
  disputeWhy: 'Why are you opening a dispute?',
  chooseReason: 'Choose a reason',
  moreDetails: 'More details (optional)',
  arbiterReads: 'The arbiter reads this when it decides.',
  sendDispute: 'Send dispute',
  back: 'Back',
  // Buttons that sign (components/Button.tsx)
  waitingWallet: 'Waiting for wallet…',
  preparing: 'Preparing…',
  openWallet: 'Open your wallet to approve, then come back here.',
  signsInWallet: 'Signs in your wallet',
  walletDeclined: 'The wallet did not sign. Nothing was sent. Try again.',
  somethingWrong: 'Something went wrong. Try again.',
};

const es: typeof en = {
  lockedCoins: (isBch) => (isBch ? 'los BCH' : 'las monedas'),
  buyerSteps: ['Confirmar', 'Bloqueo', 'Pago', 'Recepción'],
  sellerSteps: ['Aceptar', 'Bloqueo', 'Pagado', 'Liberar'],
  title: (role, done, amount, fiat) => {
    const what = `${amount} por ${fiat}`;
    if (role === 'visitor') return what;
    if (role === 'seller') return done ? `Vendiste ${what}` : `Vende ${what}`;
    return done ? `Compraste ${what}` : `Compra ${what}`;
  },
  answeredBuyOffer: (v) =>
    v.mine ? 'Respondiste la oferta del comprador' : v.you ? 'Un vendedor respondió tu oferta' : 'Un vendedor respondió la oferta de compra',
  tookOffer: (v) => (v.mine ? 'El comprador tomó tu oferta' : v.you ? 'Tomaste la oferta' : 'El comprador tomó la oferta'),
  locked: (v, coins) => (v.mine ? `Bloqueaste ${coins}` : `El vendedor bloqueó ${coins}`),
  acceptThenLock: (v, coins) =>
    v.you
      ? `Aceptas y luego el vendedor bloquea ${coins}`
      : v.mine
        ? `El comprador acepta y luego tú bloqueas ${coins}`
        : `El comprador acepta y luego el vendedor bloquea ${coins}`,
  acceptWindow: 'Hasta 10 min para aceptar y luego 30 min para bloquear',
  buyerAcceptedYouLock: (coins) => `El comprador aceptó. Bloqueas ${coins}`,
  lockingWindow: 'Plazo para bloquear: 30 min',
  accepted: (v) => (v.you || v.mine ? 'Aceptaste' : 'El comprador aceptó'),
  sellerLocks: (coins) => `El vendedor bloquea ${coins}`,
  lockWindow: 'Hasta 30 min para bloquear',
  notAccepted: (v) => (v.you ? 'No aceptaste la solicitud' : 'El comprador no aceptó'),
  notLocked: (v, coins) => (v.mine ? `No bloqueaste ${coins} a tiempo` : `El vendedor no bloqueó ${coins} a tiempo`),
  detailsEncrypted: 'Datos de pago cifrados para el comprador',
  youLock: (coins) => `Bloqueas ${coins}`,
  acceptAndLock: (v, coins) => (v.mine ? `Aceptas y bloqueas ${coins}` : `El vendedor acepta y bloquea ${coins}`),
  dropped: 'La operación quedó sin efecto',
  notAcceptedAndLocked: (coins) => `El vendedor no aceptó ni bloqueó ${coins} a tiempo`,
  pays: (v) => (v.you ? 'Envías el pago y lo marcas como pagado' : 'El comprador envía el pago y lo marca como pagado'),
  markedPaid: (v) => (v.you ? 'Marcaste el pago como enviado' : 'El comprador marcó el pago como enviado'),
  windowEnded: 'El plazo de pago terminó sin un pago',
  notMarked: (v) => (v.you ? 'No habías marcado el pago como enviado' : 'El comprador no había marcado el pago como enviado'),
  disputeFirst: 'La disputa se abrió antes',
  paymentWindow: (minutes) => `Plazo de pago: ${minutes} min`,
  disputeOpened: (v, by) => {
    if (!by) return 'Disputa abierta';
    if (by === 'seller') return v.mine ? 'Abriste una disputa' : 'El vendedor abrió una disputa';
    return v.you ? 'Abriste una disputa' : 'El comprador abrió una disputa';
  },
  waitingArbiter: 'Esperando al árbitro',
  release: (v, amount) =>
    v.mine ? 'Confirmas el pago y liberas' : `El vendedor libera ${amount} ${v.you ? 'a tu billetera' : 'al comprador'}`,
  arbiterDecides: 'El árbitro decide: los fondos van al comprador o al vendedor',
  released: (v, amount) =>
    `${v.mine ? 'Liberaste' : 'El vendedor liberó'} ${amount} ${v.you ? 'a tu billetera' : 'al comprador'}`,
  arbiterReleased: (v, amount) => `El árbitro liberó ${amount} ${v.you ? 'a tu billetera' : 'al comprador'}`,
  arbiterReturned: (v, amount) => (v.mine ? `El árbitro te devolvió ${amount}` : `El árbitro le devolvió ${amount} al vendedor`),
  cancelled: (v, amount) => `${v.you ? 'Cancelaste' : 'El comprador canceló'}: ${amount} ${v.mine ? 'volvió a ti' : 'volvió al vendedor'}`,
  refunded: (v, amount) => `${v.mine ? 'Recuperaste' : 'El vendedor recuperó'} ${amount} después del plazo de reembolso`,
  noDeposit: 'Todavía no hay un depósito que cancelar.',
  wrongWallet: 'Esta billetera no es la que tomó la operación. Conecta la billetera con la que la tomaste.',
  depositNotVisible: 'El depósito todavía no se ve en la cadena. Vuelve a intentarlo en un momento.',
  notBuyOffer: 'Esta solicitud no es para una oferta de compra.',
  outsideRange: 'El monto está fuera del rango de tu oferta.',
  otherArbiter: 'La solicitud nombra un árbitro distinto del de tu oferta.',
  otherOracle: 'El precio no está firmado por el oráculo de tu oferta.',
  noSignedPrice: 'La solicitud no tiene un precio firmado.',
  fiatMismatch: 'El monto a pagar no coincide con el precio.',
  pill: {
    waitingYou: 'Esperándote',
    waitingBuyer: 'Esperando al comprador',
    waitingSeller: 'Esperando al vendedor',
    waitingYourDeposit: 'Esperando tu depósito',
    waitingDeposit: 'Esperando el depósito',
    waitingYourPayment: 'Esperando tu pago',
    waitingPayment: 'Esperando el pago',
    waitingYourRelease: 'Pagado, esperando que liberes',
    waitingRelease: 'Pagado, esperando la liberación',
    inDispute: 'En disputa',
    completed: 'Completada',
    resolvedBuyer: 'Resuelta a favor del comprador',
    resolvedSeller: 'Resuelta a favor del vendedor',
    returned: 'Devuelta al vendedor',
    cancelled: 'Cancelada',
  },
  turnYou: 'Tu turno',
  turnOther: 'En espera',
  turnArbiter: 'En pausa · En disputa',
  progressLabel: 'Progreso de la operación',
  simulatedFiat: 'Dinero simulado',
  confirmations: (n) => (n === 0 ? 'en la mempool (0-conf)' : `${n} ${n === 1 ? 'confirmación' : 'confirmaciones'}`),
  disputeWhy: '¿Por qué abres una disputa?',
  chooseReason: 'Elige un motivo',
  moreDetails: 'Más detalles (opcional)',
  arbiterReads: 'El árbitro lo lee cuando decide.',
  sendDispute: 'Enviar la disputa',
  back: 'Atrás',
  waitingWallet: 'Esperando a la billetera…',
  preparing: 'Preparando…',
  openWallet: 'Abre tu billetera para aprobar y luego vuelve aquí.',
  signsInWallet: 'Se firma en tu billetera',
  walletDeclined: 'La billetera no firmó. No se envió nada. Inténtalo de nuevo.',
  somethingWrong: 'Algo salió mal. Inténtalo de nuevo.',
};

export const trade = { en, es };

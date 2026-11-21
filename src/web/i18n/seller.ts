// The seller's side of a trade (pages/SellerTrade.tsx, seller.ts) and the wallet scan note (coins.ts). `es` must have
// the shape of `en`. Dispute reasons are sent to the arbiter in English; the payment details the seller types are
// sealed with English field names, and only their labels change with the language.

const en = {
  disputeReasons: [
    'The buyer marked it as paid but I received nothing',
    'The amount I received is wrong',
    'The buyer is not answering',
    'Something else',
  ] as readonly string[],
  depositPlus: (amount: string, bch: string) => `${amount} plus ${bch}`,
  breakdownBch: (amount: string, fee: string) => `${amount} for the buyer plus a ${fee} fee budget for the closing transaction.`,
  breakdownToken: (amount: string, bch: string, fee: string) =>
    `${amount} and ${bch} for the buyer (tokens always travel with a little BCH), plus a ${fee} fee budget for the closing transaction.`,
  // Busy steps and errors
  accepting: 'Accepting the buyer…',
  checkingTerms: 'Checking the terms…',
  recordingDeposit: 'Recording the deposit…',
  noKeyToSeal: 'This browser does not have the key for this trade, so it cannot encrypt the payment details. Nothing was locked.',
  buyerNotAccepted: 'The buyer has not accepted yet. Nothing was locked.',
  notLocked: (isBch: boolean): string => (isBch ? 'The BCH was not locked' : 'The coins were not locked'),
  notReleased: 'The coins were not released',
  openDispute: 'Open dispute',
  // Not enough coins
  shortToken: (symbol: string) => `Your wallet does not have enough ${symbol}`,
  shortTokenBody: (amount: string, have: string, symbol: string, scan: string) =>
    `Locking needs ${amount} and Campfire can see ${have} ${symbol} in this wallet. ${scan} Send some ${symbol} to it: this page checks again every few seconds.`,
  shortBch: 'Your wallet does not have enough BCH',
  shortBchBody: (need: string, symbol: string | null, have: string, scan: string) =>
    `Locking needs about ${need}${symbol ? ` besides the ${symbol}, for the BCH that travels with the tokens and the fees,` : ''} and Campfire can see ${have} in this wallet. ${scan} Send some BCH to it: this page checks again every few seconds.`,
  checkAgain: 'Check again',
  coinsError: "We could not read your wallet's coins",
  networkSilent: 'The network did not answer.',
  // Releasing
  checkBankApp: 'I opened my bank app, not a screenshot',
  checkAmountBefore: 'I see exactly ',
  checkAmountAfter: ' from this buyer',
  bankOnly: 'Only your bank app counts',
  bankOnlyBody: (isBch: boolean): string =>
    `Don't trust screenshots or messages. Once you release, ${isBch ? 'the BCH' : 'the coins'} can't come back.`,
  releaseTo: (amount: string) => `Release ${amount} to the buyer`,
  // A buy offer: waiting for the buyer, then locking with the payment details
  waitingBuyer: 'Waiting for the buyer to accept',
  nothingLockedYet: 'Nothing is locked yet. You sign only when you lock the coins.',
  leftForBuyer: 'left for the buyer to accept at this price',
  whenBuyerAccepts: (deposit: string) =>
    `When the buyer accepts, you have 30 minutes to lock ${deposit} and share how to pay you. If the buyer does not answer in time, the request is dropped.`,
  buyerAccepted: (isBch: boolean) => `The buyer accepted. Lock ${isBch ? 'the BCH' : 'the coins'} and share how to pay you.`,
  contractOnly: 'The contract can only pay the buyer or return the coins to you. Campfire cannot move them.',
  leftToLockThen: (isBch: boolean) => `left to lock ${isBch ? 'the BCH' : 'the coins'}. After that the trade is dropped.`,
  howToPay: 'How the buyer should pay you',
  sealedHint: (isBch: boolean): string =>
    `Encrypted in your browser for this buyer only. Shown once ${isBch ? 'the BCH is' : 'the coins are'} locked. Campfire cannot read it.`,
  youLock: (deposit: string, breakdown: string) => `You lock ${deposit}: ${breakdown}`,
  lockForTrade: (label: string) => `Lock ${label} for this trade`,
  // A request on a sell offer
  acceptBuyer: 'Accept this buyer',
  leftToAcceptPrice: 'left to accept at this price.',
  sealedHintShort: 'Encrypted for this buyer only. Campfire cannot read it.',
  expired: 'This request expired',
  expiredBody: 'The signed quote ran out. The request is dropped and nothing was locked.',
  acceptAndLock: (label: string) => `Accept and lock ${label}`,
  whatAccepting: 'What accepting does',
  acceptingBody: (deposit: string, breakdown: string, isBch: boolean) =>
    `Accepting locks ${deposit} in the escrow right away: ${breakdown} It can only go to the buyer or back to you. Your payment details are shown to the buyer once ${isBch ? 'the BCH is' : 'the coins are'} locked.`,
  priceSigned: 'The price is signed by the oracle. The signature is checked again before you lock.',
  // Accepted
  leftToLockOrDrop: 'left to lock. If you do not lock in time the trade is dropped and nothing is charged.',
  youLockShown: (deposit: string, breakdown: string, isBch: boolean) =>
    `You lock ${deposit}: ${breakdown} Your payment details are shown to the buyer once ${isBch ? 'the BCH is' : 'the coins are'} locked.`,
  lock: (label: string) => `Lock ${label}`,
  // Funded
  waitingPayment: "Waiting for the buyer's payment",
  onlyBuyerOrYou: (isBch: boolean) => `${isBch ? 'The BCH is' : 'The coins are'} locked. It can only go to the buyer or back to you.`,
  leftForBuyerPay: 'left for the buyer to pay. After that the arbiter returns the coins to you.',
  checkThenRelease: 'When the buyer marks the payment as sent, check your bank app and release. Do not release before the money is there.',
  // Paid
  buyerSaysPaid: 'The buyer says they paid. Check your bank.',
  lockedUntilRelease: (isBch: boolean) => `${isBch ? 'The BCH is' : 'The coins are'} locked until you release. Take the time to check.`,
  notReceived: 'Not received yet?',
  notReceivedBody: (isBch: boolean) =>
    `Transfers can take a few minutes. ${isBch ? 'The BCH is' : 'The coins are'} still locked while you wait. If the money doesn't arrive, open a dispute and the arbiter will help.`,
  // Disputed
  disputeBy: (bySeller: boolean, on: string | null) =>
    `${bySeller ? 'You opened a dispute' : 'The buyer opened a dispute'}${on ? ` on ${on}` : ''}. The arbiter can now read the chat and will decide for the buyer or the seller. If you receive the payment meanwhile, you can still release.`,
  // The payment details form
  savedKept: 'Your earlier details are kept. Fill these in only to replace them.',
  accountLabel: (fiat: string): string => (fiat === 'ARS' ? 'Alias, CBU or CVU' : 'Account number or alias'),
  holder: 'Account holder',
  noteLabel: 'Note for the buyer (optional)',
  notePlaceholder: 'Bank name, reference to write',
  tooLong: (max: number) => `Keep the details under ${max} characters in total.`,
  // The labels of the sealed details, as the buyer reads them. The keys are what the seller's browser writes.
  detailLabels: {
    'Alias, CBU or CVU': 'Alias, CBU or CVU',
    'Account number or alias': 'Account number or alias',
    'Account holder': 'Account holder',
    Note: 'Note',
  } as Record<string, string>,
  // The deal
  youGive: 'You give',
  youReceive: 'You receive',
  marketPrice: 'Market price',
  nowForReference: ' · now, for reference',
  notAvailable: 'Not available right now',
  yourPrice: 'Your price',
  vsMarket: (percent: string) => ` · ${percent} vs market`,
  costs: (isBch: boolean): string => (isBch ? 'Fees' : 'BCH costs'),
  gain: (negative: boolean): string => (negative ? 'You get less than selling at market' : 'You gain over selling at market'),
  gainBreakdown: (gain: string, costs: string) => `${gain} from the price, −${costs} in fees`,
  // The buyer
  completedAsBuyer: (count: number) => `${count} completed as buyer`,
  since: (date: string) => ` since ${date}`,
  countedByCampfire: 'Counted by Campfire, not verifiable on-chain.',
  buyerName: "The buyer's name comes from their key; nobody chooses it. Their trade count can be inflated with a second wallet.",
  buyerKey: 'Buyer key',
  paysTo: 'Pays to',
  // Endings
  returnedTo: 'Returned to',
  youReleased: (amount: string) =>
    `You released ${amount} to the buyer. The fiat payment happened off-chain: it is between you and the buyer.`,
  decidedBuyer: 'The arbiter decided for the buyer',
  wentToBuyer: (amount: string) => `The ${amount} went to the buyer.`,
  decidedYou: 'The arbiter decided for you',
  cameBack: (amount: string) => `The ${amount} came back to you.`,
  windowEndedBody: (amount: string) => `The buyer did not mark the payment as sent in time, so the arbiter returned the ${amount} to you.`,
  buyerCancelled: 'The buyer cancelled the trade',
  coinsBack: 'The coins came back to you',
  refundBack: (amount: string) => `The ${amount} came back after the refund time.`,
  droppedBody: 'The request was declined or not funded in time. Nothing was locked.',
  backToTrades: 'Back to My trades',
  // Service fees
  feeTo: (amount: string, oracle: boolean) => `${amount} to the ${oracle ? 'price oracle' : 'arbiter'}`,
  feeNote: (parts: string) =>
    `The same transaction pays the service fees: ${parts}. They are paid in BCH and are not returned if the trade is cancelled or refunded.`,
  // seller.ts
  writeDetails: 'Write the payment details the buyer should pay to.',
  writeHow: 'Write how the buyer should pay you.',
  depositNeedsToken: (need: string, name: string, have: string) =>
    `The deposit needs ${need} ${name} and Campfire can see ${have} in this wallet. Send some ${name} to it and try again.`,
  depositNeedsBch: (need: string, have: string, token: boolean) =>
    `The deposit needs about ${need} and Campfire can see ${have} in this wallet.${token ? ' The tokens travel with a small amount of BCH, and the fees are paid in BCH.' : ''} Send some BCH to it and try again.`,
  nothingDeposited: (what: string) => `${what} Nothing was deposited.`,
  stop: {
    noEscrow: 'This trade has no escrow yet.',
    badId: 'The trade ID is not the hash of the terms.',
    badTerms: 'The terms of this trade are not valid.',
    badAddress: 'The escrow address is not the contract these terms make.',
    foreignKey: 'The terms name a signing key that does not belong to this wallet. Connect the wallet you accepted with.',
    foreignRefund: 'The terms return the coins to an address that does not belong to this wallet.',
    notRequest: 'The terms do not match the request.',
    otherFees: 'The terms charge different service fees than the ones shown with this request.',
    noBchPrice: 'Campfire could not get a BCH price to check the service fees.',
    feesTooHigh: 'The service fees are above the most Campfire may charge for this trade.',
    otherArbiter: 'The terms name a different arbiter than your offer.',
    farRefund: 'The refund time is unusually far away, so your coins could stay locked for too long.',
    otherChatKey: "The terms name a different chat key than this browser's.",
    otherOracle: "The price quote is not signed by your offer's oracle.",
    badFiat: 'The fiat amount does not match the price and the margin.',
  },
  noDepositYet: 'There is no deposit to release yet.',
  notYourWallet: 'This wallet is not the one that accepted this trade. Connect the wallet you used to accept it.',
  depositNotVisible: 'The deposit is not visible on-chain. Try again in a moment.',
  // coins.ts
  scannedPaths: (count: number, path: 'receive' | 'change') => `${count} ${path} addresses`,
  lookedAt: (paths: string) => `Campfire looked at ${paths}.`,
  noChangePath: (paths: string) =>
    `Campfire looked at ${paths}. This wallet did not share its change addresses, so coins sent there cannot be seen.`,
  readingWallet: 'Reading your wallet…',
};

const es: typeof en = {
  disputeReasons: [
    'El comprador lo marcó como pagado, pero no recibí nada',
    'El monto que recibí no es el correcto',
    'El comprador no responde',
    'Otro motivo',
  ],
  depositPlus: (amount, bch) => `${amount} más ${bch}`,
  breakdownBch: (amount, fee) => `${amount} para el comprador más ${fee} reservados para la comisión de la transacción de cierre.`,
  breakdownToken: (amount, bch, fee) =>
    `${amount} y ${bch} para el comprador (los tokens siempre viajan con un poco de BCH), más ${fee} reservados para la comisión de la transacción de cierre.`,
  accepting: 'Aceptando al comprador…',
  checkingTerms: 'Revisando las condiciones…',
  recordingDeposit: 'Registrando el depósito…',
  noKeyToSeal: 'Este navegador no tiene la clave de esta operación, así que no puede cifrar los datos de pago. No se bloqueó nada.',
  buyerNotAccepted: 'El comprador todavía no aceptó. No se bloqueó nada.',
  notLocked: (isBch) => (isBch ? 'No se bloquearon los BCH' : 'No se bloquearon las monedas'),
  notReleased: 'No se liberaron las monedas',
  openDispute: 'Abrir una disputa',
  shortToken: (symbol) => `Tu billetera no tiene suficientes ${symbol}`,
  shortTokenBody: (amount, have, symbol, scan) =>
    `Para bloquear hacen falta ${amount} y Campfire ve ${have} ${symbol} en esta billetera. ${scan} Envía ${symbol} a esta billetera: esta página vuelve a revisar cada pocos segundos.`,
  shortBch: 'Tu billetera no tiene suficientes BCH',
  shortBchBody: (need, symbol, have, scan) =>
    `Para bloquear hacen falta unos ${need}${symbol ? ` además de los ${symbol}, para los BCH que viajan con los tokens y para las comisiones,` : ''} y Campfire ve ${have} en esta billetera. ${scan} Envía BCH a esta billetera: esta página vuelve a revisar cada pocos segundos.`,
  checkAgain: 'Revisar de nuevo',
  coinsError: 'No pudimos leer las monedas de tu billetera',
  networkSilent: 'La red no respondió.',
  checkBankApp: 'Abrí la aplicación de mi banco, no una captura de pantalla',
  checkAmountBefore: 'Veo exactamente ',
  checkAmountAfter: ' de este comprador',
  bankOnly: 'Solo cuenta la aplicación de tu banco',
  bankOnlyBody: (isBch) =>
    `No confíes en capturas de pantalla ni en mensajes. Una vez que liberes, ${isBch ? 'los BCH' : 'las monedas'} no pueden volver.`,
  releaseTo: (amount) => `Liberar ${amount} al comprador`,
  waitingBuyer: 'Esperando que el comprador acepte',
  nothingLockedYet: 'Todavía no hay nada bloqueado. Firmas solo cuando bloqueas las monedas.',
  leftForBuyer: 'para que el comprador acepte a este precio',
  whenBuyerAccepts: (deposit) =>
    `Cuando el comprador acepte, tendrás 30 minutos para bloquear ${deposit} e indicar cómo pagarte. Si el comprador no responde a tiempo, la solicitud queda sin efecto.`,
  buyerAccepted: (isBch) => `El comprador aceptó. Bloquea ${isBch ? 'los BCH' : 'las monedas'} e indica cómo pagarte.`,
  contractOnly: 'El contrato solo puede pagarle al comprador o devolverte las monedas. Campfire no puede moverlas.',
  leftToLockThen: (isBch) => `para bloquear ${isBch ? 'los BCH' : 'las monedas'}. Después, la operación queda sin efecto.`,
  howToPay: 'Cómo debe pagarte el comprador',
  sealedHint: (isBch) =>
    `Se cifra en tu navegador solo para este comprador. Se muestra cuando ${isBch ? 'los BCH estén bloqueados' : 'las monedas estén bloqueadas'}. Campfire no puede leerlo.`,
  youLock: (deposit, breakdown) => `Bloqueas ${deposit}: ${breakdown}`,
  lockForTrade: (label) => `Bloquear ${label} para esta operación`,
  acceptBuyer: 'Aceptar a este comprador',
  leftToAcceptPrice: 'para aceptar a este precio.',
  sealedHintShort: 'Se cifra solo para este comprador. Campfire no puede leerlo.',
  expired: 'Esta solicitud venció',
  expiredBody: 'La cotización firmada venció. La solicitud queda sin efecto y no se bloqueó nada.',
  acceptAndLock: (label) => `Aceptar y bloquear ${label}`,
  whatAccepting: 'Qué implica aceptar',
  acceptingBody: (deposit, breakdown, isBch) =>
    `Al aceptar, se bloquean de inmediato ${deposit} en la garantía: ${breakdown} Solo pueden ir al comprador o volver a ti. Tus datos de pago se le muestran al comprador cuando ${isBch ? 'los BCH estén bloqueados' : 'las monedas estén bloqueadas'}.`,
  priceSigned: 'El precio lo firma el oráculo. La firma se vuelve a revisar antes de que bloquees.',
  leftToLockOrDrop: 'para bloquear. Si no bloqueas a tiempo, la operación queda sin efecto y no se cobra nada.',
  youLockShown: (deposit, breakdown, isBch) =>
    `Bloqueas ${deposit}: ${breakdown} Tus datos de pago se le muestran al comprador cuando ${isBch ? 'los BCH estén bloqueados' : 'las monedas estén bloqueadas'}.`,
  lock: (label) => `Bloquear ${label}`,
  waitingPayment: 'Esperando el pago del comprador',
  onlyBuyerOrYou: (isBch) =>
    `${isBch ? 'Los BCH están bloqueados' : 'Las monedas están bloqueadas'}. Solo pueden ir al comprador o volver a ti.`,
  leftForBuyerPay: 'para que el comprador pague. Después, el árbitro te devuelve las monedas.',
  checkThenRelease:
    'Cuando el comprador marque el pago como enviado, revisa la aplicación de tu banco y libera. No liberes antes de que el dinero esté ahí.',
  buyerSaysPaid: 'El comprador dice que pagó. Revisa tu banco.',
  lockedUntilRelease: (isBch) =>
    `${isBch ? 'Los BCH están bloqueados' : 'Las monedas están bloqueadas'} hasta que liberes. Tómate el tiempo para revisar.`,
  notReceived: '¿Todavía no llegó?',
  notReceivedBody: (isBch) =>
    `Las transferencias pueden tardar unos minutos. ${isBch ? 'Los BCH siguen bloqueados' : 'Las monedas siguen bloqueadas'} mientras esperas. Si el dinero no llega, abre una disputa y el árbitro te ayudará.`,
  disputeBy: (bySeller, on) =>
    `${bySeller ? 'Abriste una disputa' : 'El comprador abrió una disputa'}${on ? ` el ${on}` : ''}. El árbitro ahora puede leer el chat y decidirá a favor del comprador o del vendedor. Si mientras tanto recibes el pago, todavía puedes liberar.`,
  savedKept: 'Tus datos anteriores se conservan. Completa estos campos solo si quieres reemplazarlos.',
  accountLabel: (fiat) => (fiat === 'ARS' ? 'Alias, CBU o CVU' : 'Número de cuenta o alias'),
  holder: 'Titular de la cuenta',
  noteLabel: 'Nota para el comprador (opcional)',
  notePlaceholder: 'Nombre del banco, referencia que debe escribir',
  tooLong: (max) => `Los datos no pueden superar los ${max} caracteres en total.`,
  detailLabels: {
    'Alias, CBU or CVU': 'Alias, CBU o CVU',
    'Account number or alias': 'Número de cuenta o alias',
    'Account holder': 'Titular de la cuenta',
    Note: 'Nota',
  },
  youGive: 'Entregas',
  youReceive: 'Recibes',
  marketPrice: 'Precio de mercado',
  nowForReference: ' · actual, como referencia',
  notAvailable: 'No disponible por ahora',
  yourPrice: 'Tu precio',
  vsMarket: (percent) => ` · ${percent} respecto del mercado`,
  costs: (isBch) => (isBch ? 'Comisiones' : 'Costos en BCH'),
  gain: (negative) => (negative ? 'Recibes menos que vendiendo a precio de mercado' : 'Ganas más que vendiendo a precio de mercado'),
  gainBreakdown: (gain, costs) => `${gain} por el precio, −${costs} en comisiones`,
  completedAsBuyer: (count) => `${count} ${count === 1 ? 'completada' : 'completadas'} como comprador`,
  since: (date) => ` desde el ${date}`,
  countedByCampfire: 'Lo cuenta Campfire; no se puede verificar en la cadena.',
  buyerName:
    'El nombre del comprador sale de su clave; nadie lo elige. Su número de operaciones se puede inflar con una segunda billetera.',
  buyerKey: 'Clave del comprador',
  paysTo: 'Paga a',
  returnedTo: 'Devuelto a',
  youReleased: (amount) =>
    `Liberaste ${amount} al comprador. El pago en dinero ocurrió fuera de la cadena: es entre tú y el comprador.`,
  decidedBuyer: 'El árbitro decidió a favor del comprador',
  wentToBuyer: (amount) => `Los ${amount} fueron para el comprador.`,
  decidedYou: 'El árbitro decidió a tu favor',
  cameBack: (amount) => `Los ${amount} volvieron a ti.`,
  windowEndedBody: (amount) => `El comprador no marcó el pago como enviado a tiempo, así que el árbitro te devolvió los ${amount}.`,
  buyerCancelled: 'El comprador canceló la operación',
  coinsBack: 'Las monedas volvieron a ti',
  refundBack: (amount) => `Los ${amount} volvieron cuando se cumplió el plazo de reembolso.`,
  droppedBody: 'La solicitud se rechazó o no se financió a tiempo. No se bloqueó nada.',
  backToTrades: 'Volver a Mis operaciones',
  feeTo: (amount, oracle) => `${amount} ${oracle ? 'al oráculo de precios' : 'al árbitro'}`,
  feeNote: (parts) =>
    `La misma transacción paga las comisiones del servicio: ${parts}. Se pagan en BCH y no se devuelven si la operación se cancela o se reembolsa.`,
  writeDetails: 'Escribe los datos de pago a los que debe pagar el comprador.',
  writeHow: 'Escribe cómo debe pagarte el comprador.',
  depositNeedsToken: (need, name, have) =>
    `El depósito necesita ${need} ${name} y Campfire ve ${have} en esta billetera. Envía ${name} a esta billetera y vuelve a intentarlo.`,
  depositNeedsBch: (need, have, token) =>
    `El depósito necesita unos ${need} y Campfire ve ${have} en esta billetera.${token ? ' Los tokens viajan con un poco de BCH, y las comisiones se pagan en BCH.' : ''} Envía BCH a esta billetera y vuelve a intentarlo.`,
  nothingDeposited: (what) => `${what} No se depositó nada.`,
  stop: {
    noEscrow: 'Esta operación todavía no tiene garantía.',
    badId: 'El ID de la operación no es el hash de las condiciones.',
    badTerms: 'Las condiciones de esta operación no son válidas.',
    badAddress: 'La dirección de la garantía no es el contrato que forman estas condiciones.',
    foreignKey: 'Las condiciones nombran una clave de firma que no es de esta billetera. Conecta la billetera con la que aceptaste.',
    foreignRefund: 'Las condiciones devuelven las monedas a una dirección que no es de esta billetera.',
    notRequest: 'Las condiciones no coinciden con la solicitud.',
    otherFees: 'Las condiciones cobran comisiones del servicio distintas de las que se mostraron con esta solicitud.',
    noBchPrice: 'Campfire no pudo obtener un precio de BCH para revisar las comisiones del servicio.',
    feesTooHigh: 'Las comisiones del servicio superan el máximo que Campfire puede cobrar en esta operación.',
    otherArbiter: 'Las condiciones nombran un árbitro distinto del de tu oferta.',
    farRefund: 'El plazo de reembolso está inusualmente lejos, así que tus monedas podrían quedar bloqueadas demasiado tiempo.',
    otherChatKey: 'Las condiciones nombran una clave de chat distinta de la de este navegador.',
    otherOracle: 'La cotización no está firmada por el oráculo de tu oferta.',
    badFiat: 'El monto en dinero no coincide con el precio y el margen.',
  },
  noDepositYet: 'Todavía no hay un depósito para liberar.',
  notYourWallet: 'Esta billetera no es la que aceptó esta operación. Conecta la billetera con la que la aceptaste.',
  depositNotVisible: 'El depósito no se ve en la cadena. Vuelve a intentarlo en un momento.',
  scannedPaths: (count, path) => `${count} direcciones de ${path === 'receive' ? 'recepción' : 'cambio'}`,
  lookedAt: (paths) => `Campfire revisó ${paths}.`,
  noChangePath: (paths) =>
    `Campfire revisó ${paths}. Esta billetera no compartió sus direcciones de cambio, así que no se ven las monedas enviadas ahí.`,
  readingWallet: 'Leyendo tu billetera…',
};

export const seller = { en, es };

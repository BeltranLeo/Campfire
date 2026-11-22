// The offer page, where an offer is taken (pages/Take.tsx). `es` must have the shape of `en`; messages.ts checks it.

// Invented copy: how many trades the reader has completed with this person (hooks/useCompletedWith.ts); null while
// unknown, so a visitor without a wallet sees nothing.
const withYouText = (n: number | null) => (n === null ? null : n === 0 ? 'first time' : `${n} with you`);
const withYouTextEs = (n: number | null) => (n === null ? null : n === 0 ? 'primera vez' : `${n} contigo`);

const en = {
  back: '← Offers',
  titleSellTo: (symbol: string) => `Sell ${symbol} to this buyer`,
  titleBuy: (symbol: string) => `Buy ${symbol}`,
  titleLoading: 'Offer',
  notFound: 'This offer does not exist',
  notFoundBody: 'It may have been published from another service, or the link is incomplete.',
  backToOffers: 'Back to offers',
  loadError: 'We could not load this offer',
  noAnswer: 'The server did not answer.',
  somethingWrong: 'Something went wrong. Try again.',
  // Taking a sell offer
  fromDemoSeller: (symbol: string) => `${symbol} from Demo seller`,
  demoTag: 'Demo seller · simulated fiat',
  // An offer that lists the simulated payment next to real methods: which one applies depends on who answers.
  mixedMethods: (real: string) =>
    `Simulated payment only applies when Campfire's demo seller answers. With anyone else the payment is real: ${real}.`,
  sellerRecord: (name: string, completed: number | null, withYou: number | null) =>
    [name, completed === null ? null : `${completed} completed`, withYouText(withYou)].filter(Boolean).join(' · '),
  closed: 'This offer is closed',
  closedBySeller: 'The seller closed it or it expired. Other offers are still open.',
  closedByBuyer: 'The buyer closed it or it expired. Other offers are still open.',
  youPay: 'You pay',
  youGet: 'You get',
  typeIn: 'Type the amount in',
  between: (range: string) => `Between ${range}`,
  betweenDot: (range: string) => `Between ${range}.`,
  enterMoney: (range: string) => `Enter an amount of money, between ${range}`,
  outside: (range: string) => `That is outside what this offer accepts. Enter between ${range}`,
  enterBetween: (range: string) => `Enter an amount between ${range}.`,
  // "0.001 and 0.02 BCH": the two ends of a range inside a sentence.
  rangeEnds: (low: string, high: string) => `${low} and ${high}`,
  expired: 'This quote expired',
  expiredBody: 'The price was not refreshed for over 10 minutes. Get a new quote to continue.',
  priceHeldTake: 'Final price signed when you take it, then held 10 minutes for the seller to accept.',
  priceHeldRequest: 'Final price signed when you send the request, then held 10 minutes for the buyer to accept.',
  prepError: 'We could not prepare your wallet for this trade',
  notTaken: 'The offer was not taken',
  connectToTake: 'Connect wallet to take this offer',
  ownOffer: 'This is your own offer. Someone else has to take it.',
  seePastTrades: 'See past trades on-chain',
  newQuote: 'Get a new quote',
  takeOffer: 'Take offer',
  noSignature: 'No signature needed.',
  takeBuy: (amount: string) => `Take offer: buy ${amount}`,
  noBchNeeded: 'You do not need any BCH.',
  freeWithWallet: (fresh: boolean, coins: string) =>
    `Taking an offer is free. The seller locks the ${coins} and pays its network fee; the funds go to ${fresh ? 'a fresh address' : 'an address'} of your wallet, shown under Offer details.`,
  freeNoWallet: 'You only need a wallet to receive the funds. Taking an offer is free.',
  // Answering a buy offer
  buyerWants: (symbol: string) => `A buyer wants ${symbol}`,
  simulatedFiat: 'Simulated fiat',
  offerOnMainnet: 'Offer on mainnet',
  within: (minutes: number) => `within ${minutes} min`,
  buyerRecord: (name: string, completed: number | null, withYou: number | null) =>
    [name, completed === null ? null : `${completed} ${completed === 1 ? 'trade' : 'trades'} completed`, withYouText(withYou)]
      .filter(Boolean)
      .join(' · '),
  demoOnly: 'Only the demo seller answers this offer',
  demoOnlyBody:
    'The buyer asked for a demo answer, so the payment is simulated. Selling here would lock real coins for a payment that never comes.',
  amountToSell: 'Amount to sell',
  walletHas: (amounts: string) => ` Your wallet has ${amounts}.`,
  coinsError: "We could not read your wallet's coins",
  networkNoAnswer: 'The network did not answer.',
  notEnough: (symbol: string) => `Your wallet does not have enough ${symbol}`,
  needsToken: (need: string, have: string) => `Locking this amount needs ${need} and Campfire can see ${have}.`,
  needsBch: (need: string, token: string | null, have: string) =>
    `Locking this amount needs about ${need} with the network fee${token ? ` besides the ${token}` : ''}, and Campfire can see ${have}.`,
  buyerWouldWait: 'The buyer would accept and wait for coins you cannot lock.',
  notSent: 'The request was not sent',
  connectToSell: 'Connect wallet to sell',
  ownBuyOffer: 'This is your own offer. A seller has to answer it.',
  signLater: 'No signature yet. You sign when you lock the coins.',
  offerToSell: (amount: string | null) => (amount ? `Offer to sell ${amount}` : 'Offer to sell'),
  plus: (amount: string, bch: string) => `${amount} plus ${bch}`,
  nextTitle: 'What happens next.',
  // Taking a sell offer: the seller's deadlines are the protocol's (QUOTE_VALIDITY_SEC, FUNDING_WINDOW_SEC).
  nextTake: (demo: boolean, coins: string) =>
    demo
      ? `The demo seller accepts and locks the ${coins} in the contract right away. You pay only once the coins are locked for you; here the payment is simulated.`
      : `The seller has 10 minutes to accept, then 30 to lock the ${coins} in the contract. You pay only once the coins are locked for you. If the seller does not lock in time, the request lapses and you lose nothing.`,
  next: (lock: string | null) =>
    `The buyer accepts. Then you lock ${lock ?? 'the coins'} in the contract and share how to pay you. The buyer pays, and you release the coins.`,
  // Summary, price and details
  terms: 'Terms:',
  priceUnavailable: 'The price could not be loaded or verified. It is retried every 30 s.',
  offerDetails: 'Offer details',
  offer: 'Offer',
  sponsored: ' Publishing fee paid by Campfire',
  sellerId: 'Seller ID',
  buyerId: 'Buyer ID',
  arbiter: 'Arbiter',
  priceSource: 'Price source',
  fixedBySeller: 'Fixed by the seller',
  fixedByBuyer: 'Fixed by the buyer',
  oracle: 'Oracle',
  signedAt: (clock: string) => `, signed ${clock}`,
  payoutAddress: 'Payout address',
  freshAddress: ' A fresh address of your wallet.',
  anAddress: ' An address of your wallet.',
  // The demo seller's limits
  busy: 'The demo seller is busy with other visitors',
  busyBody: (max: number | null) => `${max === null ? '' : `It handles ${max} trades at a time. `}Please try again in a few minutes.`,
  daily: 'The demo seller has reached its daily limit of trades',
  dailyBody: (max: number | null) =>
    `${max === null ? '' : `It funds ${max} trades per day across all visitors. `}Please try again tomorrow, or see the real transactions of earlier trades.`,
  noFunds: 'The demo seller has run out of funds for this offer',
  noFundsBody: 'Please try again later, or try the other demo offer.',
};

const es: typeof en = {
  back: '← Ofertas',
  titleSellTo: (symbol) => `Vende ${symbol} a este comprador`,
  titleBuy: (symbol) => `Compra ${symbol}`,
  titleLoading: 'Oferta',
  notFound: 'Esta oferta no existe',
  notFoundBody: 'Puede haberse publicado desde otro servicio, o el enlace está incompleto.',
  backToOffers: 'Volver a las ofertas',
  loadError: 'No pudimos cargar esta oferta',
  noAnswer: 'El servidor no respondió.',
  somethingWrong: 'Algo salió mal. Inténtalo de nuevo.',
  fromDemoSeller: (symbol) => `${symbol} del vendedor de demostración`,
  demoTag: 'Vendedor de demostración · dinero simulado',
  mixedMethods: (real) =>
    `El pago simulado solo vale cuando responde el vendedor de demostración de Campfire. Con cualquier otra persona el pago es real: ${real}.`,
  sellerRecord: (name, completed, withYou) =>
    [name, completed === null ? null : `${completed} completadas`, withYouTextEs(withYou)].filter(Boolean).join(' · '),
  closed: 'Esta oferta está cerrada',
  closedBySeller: 'El vendedor la cerró o venció. Hay otras ofertas abiertas.',
  closedByBuyer: 'El comprador la cerró o venció. Hay otras ofertas abiertas.',
  youPay: 'Pagas',
  youGet: 'Recibes',
  typeIn: 'Escribir el monto en',
  between: (range) => `Entre ${range}`,
  betweenDot: (range) => `Entre ${range}.`,
  enterMoney: (range) => `Escribe un monto de dinero, entre ${range}`,
  outside: (range) => `Eso está fuera de lo que acepta esta oferta. Escribe entre ${range}`,
  enterBetween: (range) => `Escribe un monto entre ${range}.`,
  rangeEnds: (low, high) => `${low} y ${high}`,
  expired: 'Esta cotización venció',
  expiredBody: 'El precio no se actualizó en más de 10 minutos. Pide una cotización nueva para seguir.',
  priceHeldTake: 'El precio final se firma cuando la tomas y queda fijo 10 minutos para que el vendedor acepte.',
  priceHeldRequest: 'El precio final se firma cuando envías la solicitud y queda fijo 10 minutos para que el comprador acepte.',
  prepError: 'No pudimos preparar tu billetera para esta operación',
  notTaken: 'No se tomó la oferta',
  connectToTake: 'Conecta tu billetera para tomar esta oferta',
  ownOffer: 'Esta es tu propia oferta. Tiene que tomarla otra persona.',
  seePastTrades: 'Ver operaciones anteriores en la cadena',
  newQuote: 'Pedir una cotización nueva',
  takeOffer: 'Tomar la oferta',
  noSignature: 'No hace falta firmar.',
  takeBuy: (amount) => `Tomar la oferta: comprar ${amount}`,
  noBchNeeded: 'No necesitas tener BCH.',
  freeWithWallet: (fresh, coins) =>
    `Tomar una oferta es gratis. El vendedor bloquea los ${coins} y paga la comisión de red; los fondos van a ${fresh ? 'una dirección nueva' : 'una dirección'} de tu billetera, que aparece en «Detalles de la oferta».`,
  freeNoWallet: 'Solo necesitas una billetera para recibir los fondos. Tomar una oferta es gratis.',
  buyerWants: (symbol) => `Un comprador quiere ${symbol}`,
  simulatedFiat: 'Dinero simulado',
  offerOnMainnet: 'Oferta en mainnet',
  within: (minutes) => `en menos de ${minutes} min`,
  buyerRecord: (name, completed, withYou) =>
    [name, completed === null ? null : `${completed} ${completed === 1 ? 'operación completada' : 'operaciones completadas'}`, withYouTextEs(withYou)]
      .filter(Boolean)
      .join(' · '),
  demoOnly: 'Solo el vendedor de demostración responde esta oferta',
  demoOnlyBody:
    'El comprador pidió una respuesta de demostración, así que el pago es simulado. Vender aquí bloquearía monedas reales por un pago que nunca llega.',
  amountToSell: 'Monto a vender',
  walletHas: (amounts) => ` Tu billetera tiene ${amounts}.`,
  coinsError: 'No pudimos leer las monedas de tu billetera',
  networkNoAnswer: 'La red no respondió.',
  notEnough: (symbol) => `Tu billetera no tiene suficientes ${symbol}`,
  needsToken: (need, have) => `Bloquear este monto requiere ${need} y Campfire ve ${have}.`,
  needsBch: (need, token, have) =>
    `Bloquear este monto requiere unos ${need} con la comisión de red${token ? `, además de los ${token}` : ''}, y Campfire ve ${have}.`,
  buyerWouldWait: 'El comprador aceptaría y esperaría monedas que no puedes bloquear.',
  notSent: 'No se envió la solicitud',
  connectToSell: 'Conecta tu billetera para vender',
  ownBuyOffer: 'Esta es tu propia oferta. Tiene que responderla un vendedor.',
  signLater: 'Todavía no firmas nada. Firmas cuando bloqueas las monedas.',
  offerToSell: (amount) => (amount ? `Ofrecer vender ${amount}` : 'Ofrecer vender'),
  plus: (amount, bch) => `${amount} más ${bch}`,
  nextTitle: 'Qué pasa después.',
  nextTake: (demo, coins) =>
    demo
      ? `El vendedor de demostración acepta y bloquea los ${coins} en el contrato en el momento. Pagas recién cuando están bloqueados para ti; aquí el pago es simulado.`
      : `El vendedor tiene 10 minutos para aceptar y luego 30 para bloquear los ${coins} en el contrato. Pagas recién cuando están bloqueados para ti. Si no los bloquea a tiempo, la solicitud vence y no pierdes nada.`,
  next: (lock) =>
    `El comprador acepta. Luego bloqueas ${lock ?? 'las monedas'} en el contrato y compartes cómo pagarte. El comprador paga, y tú liberas las monedas.`,
  terms: 'Condiciones:',
  priceUnavailable: 'No se pudo cargar ni verificar el precio. Se reintenta cada 30 s.',
  offerDetails: 'Detalles de la oferta',
  offer: 'Oferta',
  sponsored: ' Campfire pagó la comisión de publicación',
  sellerId: 'ID del vendedor',
  buyerId: 'ID del comprador',
  arbiter: 'Árbitro',
  priceSource: 'Origen del precio',
  fixedBySeller: 'Lo fija el vendedor',
  fixedByBuyer: 'Lo fija el comprador',
  oracle: 'Oráculo',
  signedAt: (clock) => `, firmado a las ${clock}`,
  payoutAddress: 'Dirección de cobro',
  freshAddress: ' Una dirección nueva de tu billetera.',
  anAddress: ' Una dirección de tu billetera.',
  busy: 'El vendedor de demostración está ocupado con otras visitas',
  busyBody: (max) => `${max === null ? '' : `Atiende ${max} operaciones a la vez. `}Vuelve a intentarlo en unos minutos.`,
  daily: 'El vendedor de demostración llegó a su límite diario de operaciones',
  dailyBody: (max) =>
    `${max === null ? '' : `Financia ${max} operaciones por día entre todas las visitas. `}Vuelve a intentarlo mañana, o mira las transacciones reales de operaciones anteriores.`,
  noFunds: 'Al vendedor de demostración se le acabaron los fondos para esta oferta',
  noFundsBody: 'Vuelve a intentarlo más tarde, o prueba la otra oferta de demostración.',
};

export const take = { en, es };

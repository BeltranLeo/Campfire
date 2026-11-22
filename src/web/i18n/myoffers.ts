// My offers (pages/MyOffers.tsx) and the two tabs at the top of the Offers section. `es` must have the shape of `en`.

const en = {
  // The tabs shared by pages/Offers.tsx and pages/MyOffers.tsx.
  sections: 'Offer lists',
  allOffers: 'All offers',
  myOffers: 'My offers',
  createOffer: 'Create offer',
  connectTitle: 'Connect your wallet',
  connect: 'Connect wallet',
  connectBody: 'Your offers are found through your wallet. The first time in this browser, your wallet asks for one free signature that moves no funds.',
  serverSilent: 'The server did not answer.',
  somethingWrong: 'Something went wrong. Try again.',
  offersError: 'We could not load your offers',
  noOffers: 'No offers yet',
  noOffersBody: 'Offers you publish from this wallet are listed here, and you can close them.',
  notClosed: 'The offer was not closed',
  offerTitle: (buying: boolean, symbol: string, fiat: string) => (buying ? `Buying ${symbol} with ${fiat}` : `Selling ${symbol} for ${fiat}`),
  offerStatus: (status: string): string => (status === 'Published' ? 'Open' : status),
  tradeCount: (n: number) => `${n} ${n === 1 ? 'trade' : 'trades'}`,
  expires: (expired: boolean, date: string) => `${expired ? 'expired' : 'expires'} ${date}`,
  // A closed offer no longer expires: its row shows when it was published.
  published: (date: string) => `published ${date}`,
  offer: 'Offer',
  close: 'Close',
  publicationTx: 'Publication transaction',
  closingTx: 'Closing transaction',
  feePaid: 'Publishing fee paid by Campfire',
  markerWarning: 'A Campfire NFT in your wallet marks this offer. Moving or spending it closes the offer.',
  expiredNote: (buying: boolean, marker: string) =>
    `It no longer shows to ${buying ? 'sellers' : 'buyers'}. Close it to get the ${marker} marker back.`,
  closeOffer: 'Close offer',
  // Under the Close button: it still says that it signs, and that closing is final.
  closeSigns: "Signs in your wallet · can't be undone",
  // The button once the wallet has signed, while the service sends the transaction.
  closing: 'Closing…',
  closedTitle: 'Offer closed',
  closedBody: 'It no longer shows in All offers.',
  // The wallet's server no longer lists the marker, but the service's still does: no transaction was sent, and
  // either view may be the one running late.
  notYetTitle: 'Not closed yet',
  notYetBody: 'Nothing was signed or sent. Your wallet and Campfire see this offer differently right now. Try again in a minute.',
  requestsNote: 'Requests to trade on your offers show up in My trades.',
};

const es: typeof en = {
  sections: 'Listas de ofertas',
  allOffers: 'Todas las ofertas',
  myOffers: 'Mis ofertas',
  createOffer: 'Crear oferta',
  connectTitle: 'Conecta tu billetera',
  connect: 'Conectar billetera',
  connectBody: 'Tus ofertas se encuentran a través de tu billetera. La primera vez en este navegador, tu billetera te pide una firma gratuita que no mueve fondos.',
  serverSilent: 'El servidor no respondió.',
  somethingWrong: 'Algo salió mal. Vuelve a intentarlo.',
  offersError: 'No pudimos cargar tus ofertas',
  noOffers: 'Todavía no hay ofertas',
  noOffersBody: 'Aquí aparecen las ofertas que publicas desde esta billetera, y puedes cerrarlas.',
  notClosed: 'No se cerró la oferta',
  offerTitle: (buying, symbol, fiat) => (buying ? `Compras ${symbol} con ${fiat}` : `Vendes ${symbol} por ${fiat}`),
  offerStatus: (status) => (status === 'Published' ? 'Abierta' : status === 'Expired' ? 'Vencida' : status === 'Closed' ? 'Cerrada' : status),
  tradeCount: (n) => `${n} ${n === 1 ? 'operación' : 'operaciones'}`,
  expires: (expired, date) => `${expired ? 'venció el' : 'vence el'} ${date}`,
  published: (date) => `publicada el ${date}`,
  offer: 'Oferta',
  close: 'Cierre',
  publicationTx: 'Transacción de publicación',
  closingTx: 'Transacción de cierre',
  feePaid: 'Campfire pagó la comisión de publicación',
  markerWarning: 'Un NFT de Campfire en tu billetera marca esta oferta. Si lo mueves o lo gastas, la oferta se cierra.',
  expiredNote: (buying, marker) =>
    `Ya no se les muestra a los ${buying ? 'vendedores' : 'compradores'}. Ciérrala para recuperar el marcador de ${marker}.`,
  closeOffer: 'Cerrar la oferta',
  closeSigns: 'Se firma en tu billetera · no se puede deshacer',
  closing: 'Cerrando…',
  closedTitle: 'Oferta cerrada',
  closedBody: 'Ya no aparece en Todas las ofertas.',
  notYetTitle: 'Todavía no se cerró',
  notYetBody: 'No se firmó ni se envió nada. Tu billetera y Campfire ven esta oferta distinto en este momento. Vuelve a intentarlo en un minuto.',
  requestsNote: 'Las solicitudes para operar con tus ofertas aparecen en Mis operaciones.',
};

export const myoffers = { en, es };

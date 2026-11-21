// My offers (pages/MyOffers.tsx) and the two tabs at the top of the Offers section. `es` must have the shape of `en`.

const en = {
  // The tabs shared by pages/Offers.tsx and pages/MyOffers.tsx.
  sections: 'Offer lists',
  allOffers: 'All offers',
  myOffers: 'My offers',
  createOffer: 'Create offer',
  connectTitle: 'Connect your wallet',
  connect: 'Connect wallet',
  connectBody: 'Your offers are found through your wallet. Connecting needs no signature.',
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
  offer: 'Offer',
  close: 'Close',
  publicationTx: 'Publication transaction',
  closingTx: 'Closing transaction',
  feePaid: 'Publishing fee paid by Campfire',
  markerWarning: 'A Campfire NFT in your wallet marks this offer. Moving or spending it closes the offer.',
  expiredNote: (buying: boolean, marker: string) =>
    `It no longer shows to ${buying ? 'sellers' : 'buyers'}. Close it to get the ${marker} marker back.`,
  closeOffer: 'Close offer',
  requestsNote: 'Requests to trade on your offers show up in My trades.',
};

const es: typeof en = {
  sections: 'Listas de ofertas',
  allOffers: 'Todas las ofertas',
  myOffers: 'Mis ofertas',
  createOffer: 'Crear oferta',
  connectTitle: 'Conecta tu billetera',
  connect: 'Conectar billetera',
  connectBody: 'Tus ofertas se encuentran a través de tu billetera. Conectarla no requiere firmar.',
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
  offer: 'Oferta',
  close: 'Cierre',
  publicationTx: 'Transacción de publicación',
  closingTx: 'Transacción de cierre',
  feePaid: 'Campfire pagó la comisión de publicación',
  markerWarning: 'Un NFT de Campfire en tu billetera marca esta oferta. Si lo mueves o lo gastas, la oferta se cierra.',
  expiredNote: (buying, marker) =>
    `Ya no se les muestra a los ${buying ? 'vendedores' : 'compradores'}. Ciérrala para recuperar el marcador de ${marker}.`,
  closeOffer: 'Cerrar la oferta',
  requestsNote: 'Las solicitudes para operar con tus ofertas aparecen en Mis operaciones.',
};

export const myoffers = { en, es };

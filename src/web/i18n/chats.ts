// The chat list (pages/Chats.tsx and the row texts in chats.ts). `es` must have the shape of `en`.

type Role = 'buyer' | 'seller' | 'visitor';

const en = {
  title: 'Chats',
  lead: 'One conversation per trade, encrypted end to end.',
  connectTitle: 'Connect your wallet',
  connect: 'Connect wallet',
  connectBody: 'Your chats are found through your wallet. Connecting needs no signature.',
  loadError: 'We could not load your chats',
  serverSilent: 'The server did not answer.',
  empty: 'No conversations yet',
  browseOffers: 'Browse offers',
  emptyBody: 'A chat opens with every trade, so you can talk to the other person.',
  history: 'History',
  deviceOnly: 'Chats can only be read on the device that started the trade: the key never leaves it.',
  dealing: (role: Role, amount: string, fiat: string) => `${role === 'seller' ? 'Selling' : 'Buying'} ${amount} for ${fiat}`,
  openTrade: 'Open trade',
  demoSeller: 'Demo seller',
  demoBuyer: 'Demo buyer',
  sellerNamed: (name: string) => `Seller ${name}`,
  buyerNamed: (name: string) => `Buyer ${name}`,
  unread: (count: number) => `${count} unread`,
  // Row texts (chats.ts)
  verb: (seller: boolean, done: boolean): string => (seller ? (done ? 'Sold' : 'Selling') : done ? 'Bought' : 'Buying'),
  noMessages: 'No messages yet',
  opensOnAccept: 'Chat opens once accepted',
  keyElsewhere: 'Readable on the device that started it',
  unreadable: 'Message could not be read',
  imagePreview: 'Sent a receipt',
  notLoaded: 'Messages could not be loaded',
};

const es: typeof en = {
  title: 'Chats',
  lead: 'Una conversación por operación, cifrada de extremo a extremo.',
  connectTitle: 'Conecta tu billetera',
  connect: 'Conectar billetera',
  connectBody: 'Tus chats se encuentran a través de tu billetera. Conectarla no requiere firmar.',
  loadError: 'No pudimos cargar tus chats',
  serverSilent: 'El servidor no respondió.',
  empty: 'Todavía no hay conversaciones',
  browseOffers: 'Ver las ofertas',
  emptyBody: 'Cada operación abre un chat para que puedas hablar con la otra persona.',
  history: 'Historial',
  deviceOnly: 'Los chats solo se pueden leer en el dispositivo donde empezó la operación: la clave nunca sale de ahí.',
  dealing: (role, amount, fiat) => `${role === 'seller' ? 'Vendes' : 'Compras'} ${amount} por ${fiat}`,
  openTrade: 'Abrir la operación',
  demoSeller: 'Vendedor de demostración',
  demoBuyer: 'Comprador de demostración',
  sellerNamed: (name) => `Vendedor ${name}`,
  buyerNamed: (name) => `Comprador ${name}`,
  unread: (count) => `${count} sin leer`,
  verb: (seller, done) => (seller ? (done ? 'Vendiste' : 'Vendes') : done ? 'Compraste' : 'Compras'),
  noMessages: 'Todavía no hay mensajes',
  opensOnAccept: 'El chat se abre al aceptar',
  keyElsewhere: 'Se lee en el dispositivo donde empezó',
  unreadable: 'No se pudo leer el mensaje',
  imagePreview: 'Envió un comprobante',
  notLoaded: 'No se pudieron cargar los mensajes',
};

export const chats = { en, es };

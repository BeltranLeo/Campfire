// About Campfire (pages/About.tsx). `es` must have the shape of `en`. The contract's path names (release, cancel,
// arbitrate, refund) are the contract's own words and stay as they are.

const en = {
  title: 'About Campfire',
  lead: 'Campfire lets two people trade Bitcoin Cash or PUSD for pesos, dollars or any other money, with no exchange in the middle. This page explains how, step by step. Nothing here needs crypto experience.',
  getWallet: 'Get a wallet',
  walletIntro:
    'A wallet is a free app on your phone. Only you control it: Campfire never holds your money, and your BCH goes straight to your own wallet.',
  walletAfter: 'Install one, create a wallet, write down the recovery words somewhere safe, and come back here to connect it.',
  stepsTitle: 'A trade, step by step',
  steps: [
    {
      title: 'The seller publishes an offer',
      body: 'The offer says what is sold, the price (fixed, or the market price plus a margin), the range, how to pay and who the arbiter is. It is written on the Bitcoin Cash chain with a CashTokens NFT that marks it as open, so anyone can check it. The NFT is minted by a contract with no key, only for an offer that matches it.',
    },
    {
      title: 'A buyer takes it',
      body: 'The buyer picks an amount. The price is locked with a quote signed by the price oracle. Taking an offer is free and needs no signature, and the buyer does not need any BCH.',
    },
    {
      title: 'The seller locks the coins',
      body: 'The coins go into a contract made for this trade only: the escrow. The buyer’s browser rebuilds the contract from the trade terms and checks the deposit itself, instead of trusting Campfire.',
    },
    {
      title: 'The buyer pays and marks it as paid',
      body: 'The buyer pays the seller directly, by bank transfer or any method in the offer. The seller’s payment details are encrypted so that only this buyer can read them.',
    },
    {
      title: 'The seller releases the coins',
      body: 'When the money arrives, the seller signs the release and the contract pays the buyer’s wallet.',
    },
  ] as { title: string; body: string }[],
  contractTitle: 'What the contract allows',
  contractIntro:
    'The escrow is a small program on Bitcoin Cash. It has four ways out, and none of them pays anyone but the buyer or the seller. Campfire never holds the coins and cannot move them.',
  paths: {
    release: 'The seller signs: the coins go to the buyer. The normal ending.',
    cancel: 'The buyer signs: the coins go back to the seller. For when the buyer will not pay.',
    arbitrate: 'The arbiter’s signed verdict sends the coins to the buyer or to the seller, nobody else.',
    refund: '14 days after accepting the trade, the seller can take the coins back alone, in case everyone else disappears.',
  },
  everyPathBefore: 'Every path that has run on mainnet is linked on the ',
  everyPathLink: 'transparency page',
  everyPathAfter: '.',
  wrongTitle: 'If something goes wrong',
  wrongBody:
    'Each offer names an arbiter, and the buyer accepts it when taking the offer. Today Campfire is the arbiter, but the protocol lets an offer name any arbiter and any price oracle by its key. The arbiter only steps in if one of the two opens a dispute, and can only choose between them: it signs a decision, never a transaction, and can never keep the coins.',
  wrongAuto:
    'If the buyer does not mark the trade as paid before the payment window ends, the arbiter returns the coins to the seller automatically.',
  zeroConfTitle: 'No waiting for blocks',
  zeroConfTag: '0-conf with DSProofs',
  zeroConf1:
    'On Bitcoin Cash a payment can be trusted seconds after it reaches the network. When the seller locks the coins, the deposit is in every node’s memory almost at once, before it is in a block: zero confirmations, or 0-conf.',
  zeroConf2: (seconds: number) =>
    `If anyone tries to spend the same coins twice, Bitcoin Cash nodes broadcast a double-spend proof (DSProof) within seconds. The buyer’s browser asks for one. After ${seconds} quiet seconds the deposit is safe to act on, so the buyer can pay right away. If a proof appears, the page says not to pay. The coins the buyer receives are usable right away too.`,
  privacyTitle: 'Privacy',
  privacy: [
    'Connecting a wallet is the only sign-in. There are no accounts, passwords or e-mail addresses.',
    'Each trade uses a new key and a new address of your wallet, so trades are not linked on-chain.',
    'Payment details are encrypted in the browser and revealed only to the other person in the trade.',
    'The chat is end-to-end encrypted and every message is signed by its author. Campfire stores only ciphertext. The arbiter can read it only if one of you opens a dispute. It stays open for seven days after the trade ends.',
    'Campfire can link the trades of one wallet, because it counts the reputation. That count is not on-chain and can be inflated with a second wallet.',
  ] as string[],
  realTitle: 'What is real and what is simulated',
  realIntro: 'Two labels appear across the site and stay visible even when the technical details are folded:',
  realChain: 'A real Bitcoin Cash transaction on mainnet. It links to a block explorer, so you can check it.',
  realSim: 'Part of the demo. Only two things are: the fiat payment, and who decides a demo dispute.',
  realDemo: 'In a demo trade, a demo seller run by Campfire sends a few cents of real BCH through the real contract. You send no money.',
  questions: 'Questions',
  faq: [
    { q: 'Do I need BCH to buy?', a: 'No. The seller locks the coins first. You only need a wallet to receive them.' },
    {
      q: 'What does it cost?',
      a: 'Nothing for the buyer. The seller pays the network fee and a small fee to the arbiter and, at market price, to the price oracle: 0.5% each today. The fees are shown before anything is locked, and Campfire pays the fee to publish a buy offer.',
    },
    {
      q: 'Who holds the coins during a trade?',
      a: 'A contract on the Bitcoin Cash network. It can only pay the buyer or return the coins to the seller. Campfire cannot move them.',
    },
    {
      q: 'What if the other person disappears?',
      a: 'Either of you can open a dispute. An arbiter named in the offer then decides who gets the coins. The arbiter can never keep them.',
    },
    {
      q: 'When does my wallet ask me to sign?',
      a: 'Only when coins move: publishing a sell offer, locking coins, releasing them, or cancelling. Buttons that open your wallet say so.',
    },
    {
      q: 'What does “Simulated” mean?',
      a: 'In demo trades the bank payment is not real. Everything marked “On-chain” is a real transaction you can check.',
    },
    { q: 'What is PUSD?', a: 'A dollar token that lives on Bitcoin Cash. 1 PUSD stays close to 1 US dollar.' },
  ] as { q: string; a: string }[],
  tryDemo: 'Try the demo',
  tryDemoNote: 'A real trade with simulated fiat',
  transparency: 'Transparency',
  transparencyNote: 'Every contract path on mainnet',
  spec: 'Protocol spec',
  specNote: 'The details, for developers',
  openSource: 'Campfire is open source: ',
  builtFor: '. Built for BCH BLAZE 2026.',
};

const es: typeof en = {
  title: 'Acerca de Campfire',
  lead: 'Campfire permite que dos personas intercambien Bitcoin Cash o PUSD por pesos, dólares o cualquier otra moneda, sin una plataforma en el medio. Esta página explica cómo, paso a paso. No hace falta saber de criptomonedas.',
  getWallet: 'Consigue una billetera',
  walletIntro:
    'Una billetera es una aplicación gratuita para tu teléfono. Solo tú la controlas: Campfire nunca guarda tu dinero, y tus BCH van directo a tu propia billetera.',
  walletAfter: 'Instala una, crea una billetera, anota las palabras de recuperación en un lugar seguro y vuelve aquí para conectarla.',
  stepsTitle: 'Una operación, paso a paso',
  steps: [
    {
      title: 'El vendedor publica una oferta',
      body: 'La oferta dice qué se vende, el precio (fijo, o el de mercado más un margen), el rango, cómo pagar y quién es el árbitro. Se escribe en la cadena de Bitcoin Cash con un NFT de CashTokens que la marca como abierta, así que cualquiera puede comprobarla. El NFT lo acuña un contrato sin clave, solo para una oferta que coincide con él.',
    },
    {
      title: 'Un comprador la toma',
      body: 'El comprador elige un monto. El precio queda fijo con una cotización firmada por el oráculo de precios. Tomar una oferta es gratis y no hace falta firmar, y el comprador no necesita tener BCH.',
    },
    {
      title: 'El vendedor bloquea las monedas',
      body: 'Las monedas van a un contrato hecho solo para esta operación: la garantía. El navegador del comprador reconstruye el contrato a partir de las condiciones y revisa el depósito por su cuenta, en lugar de confiar en Campfire.',
    },
    {
      title: 'El comprador paga y lo marca como pagado',
      body: 'El comprador le paga directamente al vendedor, por transferencia bancaria o cualquier método de la oferta. Los datos de pago del vendedor están cifrados para que solo este comprador pueda leerlos.',
    },
    {
      title: 'El vendedor libera las monedas',
      body: 'Cuando llega el dinero, el vendedor firma la liberación y el contrato le paga a la billetera del comprador.',
    },
  ],
  contractTitle: 'Qué permite el contrato',
  contractIntro:
    'La garantía es un pequeño programa en Bitcoin Cash. Tiene cuatro salidas, y ninguna le paga a nadie más que al comprador o al vendedor. Campfire nunca guarda las monedas y no puede moverlas.',
  paths: {
    release: 'Firma el vendedor: las monedas van al comprador. Es el final normal.',
    cancel: 'Firma el comprador: las monedas vuelven al vendedor. Para cuando el comprador no va a pagar.',
    arbitrate: 'La decisión firmada del árbitro envía las monedas al comprador o al vendedor, a nadie más.',
    refund: '14 días después de aceptar la operación, el vendedor puede recuperar las monedas por su cuenta, por si todos los demás desaparecen.',
  },
  everyPathBefore: 'Cada salida que se usó en mainnet está enlazada en la ',
  everyPathLink: 'página de transparencia',
  everyPathAfter: '.',
  wrongTitle: 'Si algo sale mal',
  wrongBody:
    'Cada oferta nombra un árbitro, y el comprador lo acepta al tomar la oferta. Hoy el árbitro es Campfire, pero el protocolo permite que una oferta nombre a cualquier árbitro y a cualquier oráculo de precios por su clave. El árbitro solo interviene si uno de los dos abre una disputa, y solo puede elegir entre ellos: firma una decisión, nunca una transacción, y nunca puede quedarse con las monedas.',
  wrongAuto:
    'Si el comprador no marca la operación como pagada antes de que termine el plazo de pago, el árbitro le devuelve las monedas al vendedor automáticamente.',
  zeroConfTitle: 'Sin esperar bloques',
  zeroConfTag: '0-conf con DSProofs',
  zeroConf1:
    'En Bitcoin Cash se puede confiar en un pago segundos después de que llega a la red. Cuando el vendedor bloquea las monedas, el depósito está en la memoria de todos los nodos casi de inmediato, antes de entrar en un bloque: cero confirmaciones, o 0-conf.',
  zeroConf2: (seconds) =>
    `Si alguien intenta gastar las mismas monedas dos veces, los nodos de Bitcoin Cash difunden una prueba de doble gasto (DSProof) en segundos. El navegador del comprador la busca. Tras ${seconds} segundos sin novedades, ya se puede confiar en el depósito, así que el comprador puede pagar enseguida. Si aparece una prueba, la página le dice que no pague. Las monedas que recibe el comprador también se pueden usar enseguida.`,
  privacyTitle: 'Privacidad',
  privacy: [
    'Conectar una billetera es el único inicio de sesión. No hay cuentas, contraseñas ni correos electrónicos.',
    'Cada operación usa una clave nueva y una dirección nueva de tu billetera, así que las operaciones no quedan vinculadas en la cadena.',
    'Los datos de pago se cifran en el navegador y solo se le revelan a la otra persona de la operación.',
    'El chat está cifrado de punta a punta y cada mensaje lo firma su autor. Campfire solo guarda texto cifrado. El árbitro puede leerlo solo si uno de los dos abre una disputa. Sigue abierto siete días después de que termina la operación.',
    'Campfire puede vincular las operaciones de una billetera, porque cuenta la reputación. Ese número no está en la cadena y se puede inflar con una segunda billetera.',
  ],
  realTitle: 'Qué es real y qué es simulado',
  realIntro: 'En todo el sitio aparecen dos etiquetas, que se ven incluso con los detalles técnicos ocultos:',
  realChain: 'Una transacción real de Bitcoin Cash en mainnet. Enlaza a un explorador de bloques, así que puedes comprobarla.',
  realSim: 'Parte de la demostración. Solo hay dos cosas simuladas: el pago en dinero y quién decide una disputa de demostración.',
  realDemo:
    'En una operación de demostración, un vendedor de demostración administrado por Campfire envía unos centavos de BCH reales a través del contrato real. Tú no envías dinero.',
  questions: 'Preguntas',
  faq: [
    { q: '¿Necesito BCH para comprar?', a: 'No. Primero el vendedor bloquea las monedas. Solo necesitas una billetera para recibirlas.' },
    {
      q: '¿Cuánto cuesta?',
      a: 'Nada para el comprador. El vendedor paga la comisión de la red y una pequeña tarifa al árbitro y, con precio de mercado, al oráculo de precios: hoy, 0,5 % cada una. Las tarifas se muestran antes de bloquear nada, y Campfire paga la comisión para publicar una oferta de compra.',
    },
    {
      q: '¿Quién tiene las monedas durante una operación?',
      a: 'Un contrato en la red de Bitcoin Cash. Solo puede pagarle al comprador o devolverle las monedas al vendedor. Campfire no puede moverlas.',
    },
    {
      q: '¿Qué pasa si la otra persona desaparece?',
      a: 'Cualquiera de los dos puede abrir una disputa. Entonces un árbitro nombrado en la oferta decide quién recibe las monedas. El árbitro nunca puede quedarse con ellas.',
    },
    {
      q: '¿Cuándo me pide firmar mi billetera?',
      a: 'Solo cuando se mueven monedas: al publicar una oferta de venta, bloquear monedas, liberarlas o cancelar. Los botones que abren tu billetera lo indican.',
    },
    {
      q: '¿Qué significa «Simulado»?',
      a: 'En las operaciones de demostración el pago bancario no es real. Todo lo marcado como «En la cadena» es una transacción real que puedes comprobar.',
    },
    { q: '¿Qué es PUSD?', a: 'Un token en dólares que vive en Bitcoin Cash. 1 PUSD se mantiene cerca de 1 dólar estadounidense.' },
  ],
  tryDemo: 'Prueba la demostración',
  tryDemoNote: 'Una operación real con pago simulado',
  transparency: 'Transparencia',
  transparencyNote: 'Cada salida del contrato en mainnet',
  spec: 'Especificación del protocolo',
  specNote: 'Los detalles, para desarrolladores',
  openSource: 'Campfire es de código abierto: ',
  builtFor: '. Hecho para BCH BLAZE 2026.',
};

export const about = { en, es };

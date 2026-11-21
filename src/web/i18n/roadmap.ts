// The roadmap (pages/Roadmap.tsx). `es` must have the shape of `en`.

const en = {
  title: 'Roadmap',
  lead: 'Campfire is in beta. Expect big changes, and expect some of them to break things you are used to. This page lists what we plan to build next. None of it works yet.',
  todayBefore: 'What works today is explained on ',
  howItWorks: 'How it works',
  todayMiddle: ', and every real transaction is on the ',
  transparencyPage: 'transparency page',
  todayAfter: '.',
  planned: 'Planned',
  sections: [
    {
      title: 'Offers and disputes',
      items: [
        {
          title: 'Offer documents on public IPFS',
          body: 'Today the service stores each offer’s document and serves it by its hash. Pinning it to IPFS keeps it available even if the service goes away.',
        },
        {
          title: 'Independent arbiters and price oracles',
          body: 'An offer can already name any arbiter and any oracle by its key. A place to find them and choose one is missing; for now Campfire is both.',
        },
        {
          title: 'Split verdicts',
          body: 'Today the arbiter can only give all the coins to one side. A split would fit disputes where both are partly right.',
        },
        {
          title: 'An open offer index',
          body: 'Every offer is already on the chain, but today Campfire’s service keeps the list. A public indexer would rebuild it from the chain, so any app can show the same offers.',
        },
      ],
    },
    {
      title: 'Fees and reputation',
      items: [
        {
          title: 'Lower fees for good traders',
          body: 'The more trades you complete, the lower your fees. Trades between two wallets of the same person will not count.',
        },
        {
          title: 'A fuller reputation',
          body: 'Today Campfire counts completed trades, and a second wallet can inflate that count. Next: ratings, volume and the number of different people someone has traded with.',
        },
        {
          title: 'Choose your own name',
          body: 'A name you pick, signed by your wallet and unique across Campfire, instead of the one made from your identity.',
        },
        {
          title: 'Portable identity',
          body: 'Your identity and your reputation as a CashTokens NFT in your wallet, which any app built on the protocol can read. Offers already go to your wallet’s main address, so the path is ready.',
        },
      ],
    },
    {
      title: 'More ways to trade',
      items: [
        {
          title: 'More currencies',
          body: 'Offers are priced in Argentine pesos or US dollars today. More local currencies, with a market price from the oracle or a fixed price set by the seller.',
        },
        {
          title: 'Notifications when Campfire is closed',
          body: 'Today you are told about a new request or message only while the page is open. A buyer should also hear when a seller takes their offer, and have longer to accept it.',
        },
        {
          title: 'Campfire in more languages',
          body: 'Today Campfire can be read in English and Spanish. Next: more languages, and numbers written the way each country writes them.',
        },
      ],
    },
    {
      title: 'Privacy and security',
      items: [
        {
          title: 'More privacy tools',
          body: 'Each trade already uses a new key and a new address of your wallet. Further tools would make trades harder to link together.',
        },
        {
          title: 'Security hardening',
          body: 'An ongoing review of the service, the contracts and the app, with fixes as issues are found. Until then, trade small amounts.',
        },
      ],
    },
  ] as { title: string; items: { title: string; body: string }[] }[],
  designBefore: 'The design behind these plans is in the ',
  spec: 'protocol spec',
  designAfter: '. Campfire is open source: ',
};

const es: typeof en = {
  title: 'Hoja de ruta',
  lead: 'Campfire está en beta. Espera cambios grandes, y que algunos rompan cosas que ya conoces. Esta página lista lo que planeamos construir. Nada de esto funciona todavía.',
  todayBefore: 'Lo que funciona hoy se explica en ',
  howItWorks: 'Cómo funciona',
  todayMiddle: ', y cada transacción real está en la ',
  transparencyPage: 'página de transparencia',
  todayAfter: '.',
  planned: 'Planeado',
  sections: [
    {
      title: 'Ofertas y disputas',
      items: [
        {
          title: 'Documentos de oferta en IPFS público',
          body: 'Hoy el servicio guarda el documento de cada oferta y lo sirve por su hash. Fijarlo en IPFS lo mantiene disponible aunque el servicio desaparezca.',
        },
        {
          title: 'Árbitros y oráculos de precios independientes',
          body: 'Una oferta ya puede nombrar a cualquier árbitro y a cualquier oráculo por su clave. Falta un lugar donde encontrarlos y elegir uno; por ahora Campfire cumple los dos papeles.',
        },
        {
          title: 'Decisiones repartidas',
          body: 'Hoy el árbitro solo puede darle todas las monedas a una de las partes. Repartirlas serviría en disputas donde los dos tienen parte de razón.',
        },
        {
          title: 'Un índice abierto de ofertas',
          body: 'Cada oferta ya está en la cadena, pero hoy la lista la lleva el servicio de Campfire. Un indexador público la reconstruiría desde la cadena, para que cualquier aplicación muestre las mismas ofertas.',
        },
      ],
    },
    {
      title: 'Comisiones y reputación',
      items: [
        {
          title: 'Comisiones más bajas para quien opera bien',
          body: 'Cuantas más operaciones completes, más bajas tus comisiones. No contarán las operaciones entre dos billeteras de la misma persona.',
        },
        {
          title: 'Una reputación más completa',
          body: 'Hoy Campfire cuenta las operaciones completadas, y una segunda billetera puede inflar ese número. Lo siguiente: calificaciones, volumen y la cantidad de personas distintas con las que alguien operó.',
        },
        {
          title: 'Elige tu propio nombre',
          body: 'Un nombre que eliges tú, firmado por tu billetera y único en Campfire, en lugar del que sale de tu identidad.',
        },
        {
          title: 'Identidad portable',
          body: 'Tu identidad y tu reputación como un NFT de CashTokens en tu billetera, que cualquier aplicación hecha sobre el protocolo pueda leer. Las ofertas ya van a la dirección principal de tu billetera, así que el camino está listo.',
        },
      ],
    },
    {
      title: 'Más formas de operar',
      items: [
        {
          title: 'Más monedas',
          body: 'Hoy las ofertas tienen precio en pesos argentinos o dólares estadounidenses. Vendrán más monedas locales, con un precio de mercado del oráculo o un precio fijo del vendedor.',
        },
        {
          title: 'Avisos con Campfire cerrado',
          body: 'Hoy te enteras de una solicitud o un mensaje nuevo solo mientras la página está abierta. Un comprador también debería enterarse cuando un vendedor toma su oferta, y tener más tiempo para aceptarla.',
        },
        {
          title: 'Campfire en más idiomas',
          body: 'Hoy Campfire se puede leer en inglés y en español. Lo siguiente: más idiomas, y números escritos como se escriben en cada país.',
        },
      ],
    },
    {
      title: 'Privacidad y seguridad',
      items: [
        {
          title: 'Más herramientas de privacidad',
          body: 'Cada operación ya usa una clave nueva y una dirección nueva de tu billetera. Otras herramientas harían más difícil vincular las operaciones entre sí.',
        },
        {
          title: 'Refuerzo de seguridad',
          body: 'Una revisión continua del servicio, los contratos y la aplicación, con arreglos a medida que aparezcan problemas. Mientras tanto, opera con montos pequeños.',
        },
      ],
    },
  ],
  designBefore: 'El diseño detrás de estos planes está en la ',
  spec: 'especificación del protocolo',
  designAfter: '. Campfire es de código abierto: ',
};

export const roadmap = { en, es };

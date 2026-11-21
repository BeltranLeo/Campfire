// Spanish for the landing page. Aye's markup and script stay in English; in Spanish the page swaps each English
// text for its translation here, as it is drawn (see translate.ts). Keys are the English texts with their spaces
// collapsed, exactly as they appear in landing.html and motion.js.

export const ES_TEXT: Record<string, string> = {
  // Header, section rail and footer
  'Why Campfire': 'Por qué Campfire',
  'How it works': 'Cómo funciona',
  'Try a trade': 'Pruébalo',
  FAQ: 'Preguntas',
  'Try the demo trade': 'Probar la demo',
  Menu: 'Menú',
  Start: 'Inicio',
  'Why Campfire?': '¿Por qué Campfire?',
  'Who goes first?': '¿Quién va primero?',
  'How does it work?': '¿Cómo funciona?',
  'Questions?': '¿Preguntas?',
  'Get started': 'Empieza',
  'Peer-to-peer Bitcoin Cash, held by a contract anyone can check.':
    'Bitcoin Cash entre personas, custodiado por un contrato que cualquiera puede comprobar.',
  Product: 'Producto',
  Offers: 'Ofertas',
  'Demo trade': 'Operación de demostración',
  'My trades': 'Mis operaciones',
  Learn: 'Aprende',
  About: 'Acerca de',
  Verify: 'Comprueba',
  Transparency: 'Transparencia',
  'Source code': 'Código fuente',
  'Built for BCH BLAZE 2026.': 'Hecho para BCH BLAZE 2026.',
  'Campfire never holds your coins.': 'Campfire nunca guarda tus monedas.',
  'Campfire home': 'Inicio de Campfire',
  Main: 'Principal',
  'Page sections': 'Secciones de la página',
  'Question topics': 'Temas de las preguntas',

  // Hero
  'Peer-to-peer Bitcoin Cash': 'Bitcoin Cash entre personas',
  'Trade without': 'Opera sin',
  'intermediaries.': 'intermediarios.',
  'Buy or sell Bitcoin Cash or PUSD directly with another person, for fiat money and with the payment methods you already use. While you trade, a contract on the blockchain holds the coins — not Campfire, not anyone.':
    'Compra o vende Bitcoin Cash o PUSD directamente con otra persona, por dinero fíat y con los medios de pago que ya usas. Mientras operas, las monedas las guarda un contrato en la cadena de bloques: ni Campfire ni nadie.',
  'See offers': 'Ver ofertas',
  'No account, no password': 'Sin cuenta ni contraseña',
  "You don't need BCH to buy": 'No necesitas BCH para comprar',
  'Offers and coins checkable on-chain': 'Ofertas y monedas, comprobables en la cadena',
  'Locked in the contract': 'Bloqueado en el contrato',
  'Example trade': 'Operación de ejemplo',
  'To the buyer, when the seller releases': 'Al comprador, cuando el vendedor libera',
  "Back to the seller, if it doesn't complete": 'De vuelta al vendedor, si no se completa',
  'Safe at 0-conf': 'Seguro con 0 confirmaciones',
  'Your turn: mark as paid': 'Tu turno: marca como pagado',
  'Explore Campfire ↓': 'Explora Campfire ↓',

  // Why Campfire?
  'Non-custodial · Verifiable · Peer-to-peer': 'Sin custodia · Comprobable · Entre personas',
  'Nobody can keep your coins.': 'Nadie puede quedarse con tus monedas.',
  'The contract has a short list of exits, and none of them leads to Campfire or the arbiter.':
    'El contrato tiene una lista corta de salidas, y ninguna lleva a Campfire ni al árbitro.',
  'You never hand your coins to a company.': 'Nunca le entregas tus monedas a una empresa.',
  'Your wallet is your login.': 'Tu billetera es tu inicio de sesión.',
  "No account, password or e-mail. Each trade uses a new address of your wallet, so trades aren't linked on-chain.":
    'Sin cuenta, contraseña ni correo. Cada operación usa una dirección nueva de tu billetera, así que las operaciones no quedan vinculadas en la cadena.',
  'Start in minutes, share less about yourself.': 'Empieza en minutos y comparte menos sobre ti.',
  'Check it yourself.': 'Compruébalo tú.',
  'Your browser verifies the deposit on its own. Every contract exit is listed on the Transparency page.':
    'Tu navegador verifica el depósito por su cuenta. Cada salida de un contrato figura en la página de Transparencia.',
  "Trust you can verify, not trust you're asked for.": 'Confianza que puedes verificar, no confianza que te piden.',
  'Buy with zero BCH.': 'Compra con cero BCH.',
  'To buy you only need a wallet to receive. Pay the seller in fiat money, with the payment methods you already use.':
    'Para comprar solo necesitas una billetera donde recibir. Le pagas al vendedor en dinero fíat, con los medios de pago que ya usas.',
  "Your first BCH doesn't need someone else's BCH.": 'Tus primeros BCH no necesitan los BCH de otro.',

  // Who goes first?
  'Trading with a stranger, someone has to go first. Either you send the money and hope, or you hand your coins to a platform and trust it. Campfire changes who goes first.':
    'Al operar con un desconocido, alguien tiene que ir primero. O envías el dinero y esperas, o le entregas tus monedas a una plataforma y confías en ella. Campfire cambia quién va primero.',
  'The usual way': 'Lo habitual',
  'A middleman holds your coins.': 'Un intermediario guarda tus monedas.',
  You: 'Tú',
  "A platform's wallet": 'La billetera de una plataforma',
  Frozen: 'Congelado',
  'The other person': 'La otra persona',
  "You can't see what happens to the coins. If the platform freezes, fails or disappears, you wait — or you lose them.":
    'No puedes ver qué pasa con las monedas. Si la plataforma las congela, quiebra o desaparece, esperas… o las pierdes.',
  'With Campfire': 'Con Campfire',
  'A contract goes first.': 'Un contrato va primero.',
  Seller: 'Vendedor',
  'Contract on the blockchain': 'Contrato en la cadena de bloques',
  Buyer: 'Comprador',
  '✓ Received': '✓ Recibido',
  'The seller locks the coins in a contract anyone can inspect. It can only pay the buyer or give them back to the seller. Nobody else — not even Campfire — can take them.':
    'El vendedor bloquea las monedas en un contrato que cualquiera puede inspeccionar. Solo puede pagarle al comprador o devolvérselas al vendedor. Nadie más, ni siquiera Campfire, puede tomarlas.',
  'Locked like a vault.': 'Cerrado como una bóveda.',
  'Clear as glass.': 'Transparente como el vidrio.',
  'Locked like a vault. Clear as glass.': 'Cerrado como una bóveda. Transparente como el vidrio.',

  // How does it work?
  'Inside the contract': 'Dentro del contrato',
  'A seller and a buyer.': 'Un vendedor y un comprador.',
  'One has Bitcoin Cash, the other has fiat money. Each signs in with a compatible Bitcoin Cash wallet. Between them, a space for something they can both trust.':
    'Uno tiene Bitcoin Cash; el otro, dinero fíat. Cada uno entra con una billetera de Bitcoin Cash compatible. Entre los dos, un espacio para algo en lo que ambos pueden confiar.',
  'The contract': 'El contrato',
  'The coins go into a contract.': 'Las monedas entran en un contrato.',
  "Each trade creates its own contract on the Bitcoin Cash network. The seller locks the coins there, and from then on only the contract's rules can move them.":
    'Cada operación crea su propio contrato en la red de Bitcoin Cash. El vendedor bloquea ahí las monedas y, desde entonces, solo las reglas del contrato pueden moverlas.',
  'The network': 'La red',
  'The network verifies every move.': 'La red verifica cada movimiento.',
  'Your browser rebuilds the contract and checks the deposit on its own, without trusting Campfire. Every move is a real transaction anyone can look up.':
    'Tu navegador reconstruye el contrato y comprueba el depósito por su cuenta, sin confiar en Campfire. Cada movimiento es una transacción real que cualquiera puede consultar.',
  'The arbiter': 'El árbitro',
  'If something goes wrong, someone mediates.': 'Si algo sale mal, alguien media.',
  'Either person can open a dispute. An arbiter named in the offer decides who gets the coins: the buyer or the seller. The arbiter can never keep them.':
    'Cualquiera de los dos puede abrir una disputa. Un árbitro indicado en la oferta decide quién recibe las monedas: el comprador o el vendedor. El árbitro nunca puede quedárselas.',
  'Four ways out': 'Cuatro salidas',
  'Every possible ending is written in the code.': 'Cada final posible está escrito en el código.',
  'Release → buyer': 'Liberar → comprador',
  'The seller signs. The normal ending.': 'Firma el vendedor. El final normal.',
  'Cancel → seller': 'Cancelar → vendedor',
  "The buyer signs. For when they won't pay.": 'Firma el comprador. Para cuando no va a pagar.',
  Arbitrate: 'Arbitraje',
  "The arbiter's verdict pays the buyer or the seller. Nobody else.":
    'La decisión del árbitro le paga al comprador o al vendedor. A nadie más.',
  'Refund after 14 days': 'Reembolso después de 14 días',
  'If nothing else happened, the coins go back to the seller. No signature needed.':
    'Si no pasó nada más, las monedas vuelven al vendedor. No hace falta ninguna firma.',
  'Technical details': 'Detalles técnicos',
  'CashScript contract': 'Contrato en CashScript',
  ', one per trade, with exactly these four spending paths.':
    ', uno por operación, con exactamente estas cuatro formas de gastar.',
  'Source on GitHub': 'Código en GitHub',
  '0-conf with DSProofs:': '0 confirmaciones con DSProofs:',
  'after 5 quiet seconds without a double-spend proof, the deposit is safe to act on.':
    'tras 5 segundos tranquilos sin una prueba de doble gasto, se puede actuar sobre el depósito.',
  'New keys per trade:': 'Claves nuevas en cada operación:',
  "each trade uses a fresh address of your wallet, so trades aren't linked on-chain.":
    'cada operación usa una dirección nueva de tu billetera, así que las operaciones no quedan vinculadas en la cadena.',
  'Encrypted payment details:': 'Datos de pago cifrados:',
  'revealed in the browser only to the other person in the trade.':
    'se revelan en el navegador solo a la otra persona de la operación.',
  'Transparency page:': 'Página de Transparencia:',
  'every contract exit, with its transaction once it has run on mainnet.':
    'cada salida de un contrato, con su transacción cuando ya se ejecutó en la red principal.',
  'Has BCH': 'Tiene BCH',
  'Has fiat money': 'Tiene dinero fíat',
  Contract: 'Contrato',
  'Holds the coins': 'Guarda las monedas',
  'BCH network': 'Red de BCH',
  'Verifies every move': 'Verifica cada movimiento',
  Arbiter: 'Árbitro',
  'Disputes and time-outs': 'Disputas y plazos vencidos',

  // Want to try a trade?
  'Want to try a trade?': '¿Quieres probar una operación?',
  'Pick a side. Scroll to follow the trade, or tap the phone to play it yourself. Nothing here touches the network.':
    'Elige un lado. Desplázate para seguir la operación, o toca el teléfono para jugarla tú. Nada de esto toca la red.',
  'Choose a side': 'Elige un lado',
  Sell: 'Vender',
  Buy: 'Comprar',
  'Simulated · example data': 'Simulado · datos de ejemplo',
  "What if the buyer doesn't pay?": '¿Y si el comprador no paga?',
  "What if I don't pay in time?": '¿Y si no pago a tiempo?',
  'You start with': 'Empiezas con',
  'You get': 'Recibes',
  'Your key moment': 'Tu momento clave',
  'Fiat money, in your account': 'Dinero fíat, en tu cuenta',
  'Release only with the money in your bank app': 'Libera solo con el dinero en la aplicación de tu banco',
  'Fiat money — no BCH needed': 'Dinero fíat, sin necesidad de BCH',
  'Bitcoin Cash, in your wallet': 'Bitcoin Cash, en tu billetera',
  'Pay only after “Safe at 0-conf”': 'Paga solo después de «Seguro con 0 confirmaciones»',
  'What you do': 'Qué haces',
  'What happens': 'Qué pasa',
  'Your turn': 'Tu turno',
  'Set your price and publish.': 'Fija tu precio y publica.',
  'Choose your margin over the market price, how much you sell, how buyers can pay you and how long they have to pay.':
    'Elige tu margen sobre el precio de mercado, cuánto vendes, cómo pueden pagarte y cuánto tiempo tienen para pagar.',
  'Nothing is locked yet: the offer is an announcement until someone takes it. Publishing costs less than a cent.':
    'Todavía no se bloquea nada: la oferta es un anuncio hasta que alguien la toma. Publicarla cuesta menos de un centavo.',
  'Time is running': 'El tiempo corre',
  'Accept a buyer.': 'Acepta a un comprador.',
  'A buyer takes your offer. You have 10 minutes to accept.':
    'Un comprador toma tu oferta. Tienes 10 minutos para aceptar.',
  "The price is held while the clock runs. If you don't accept, the request is dropped.":
    'El precio se mantiene mientras corre el reloj. Si no aceptas, la solicitud se descarta.',
  'The contract holds them': 'El contrato las guarda',
  'Lock the coins in the contract.': 'Bloquea las monedas en el contrato.',
  'Sign once in your wallet. You have up to 30 minutes to lock.':
    'Firma una vez en tu billetera. Tienes hasta 30 minutos para bloquear.',
  'A contract made only for this trade holds the coins. It can pay the buyer or return them to you.':
    'Un contrato hecho solo para esta operación guarda las monedas. Puede pagarle al comprador o devolvértelas.',
  'Someone else is working': 'Otra persona está trabajando',
  'Wait for the payment.': 'Espera el pago.',
  'Nothing. The buyer pays you outside Campfire, within the time you set.':
    'Nada. El comprador te paga fuera de Campfire, dentro del plazo que fijaste.',
  "If the buyer doesn't pay in time, the arbiter sends the coins back to you automatically.":
    'Si el comprador no paga a tiempo, el árbitro te devuelve las monedas automáticamente.',
  'Check before you act': 'Comprueba antes de actuar',
  'Check your bank app, then release.': 'Revisa la aplicación de tu banco y después libera.',
  'Confirm the exact amount in your own bank app — not a screenshot. Then release.':
    'Confirma el monto exacto en la aplicación de tu propio banco, no en una captura. Después libera.',
  "Releasing pays the buyer from the contract. It can't be undone.":
    'Liberar le paga al comprador desde el contrato. No se puede deshacer.',
  'Confirmed on-chain': 'Confirmado en la cadena',
  'You got paid.': 'Cobraste.',
  'Nothing else to do.': 'No hay nada más que hacer.',
  'The payout is a real transaction anyone can check on-chain.':
    'El pago es una transacción real que cualquiera puede comprobar en la cadena.',
  'Pick an offer and take it.': 'Elige una oferta y tómala.',
  'Compare price, payment method and time to pay. Type how much BCH you want.':
    'Compara precio, medio de pago y plazo para pagar. Escribe cuántos BCH quieres.',
  "You don't need any BCH. Your wallet only gives an address to receive.":
    'No necesitas BCH. Tu billetera solo da una dirección para recibir.',
  'The seller locks the coins.': 'El vendedor bloquea las monedas.',
  "Wait. Don't pay anything yet.": 'Espera. Todavía no pagues nada.',
  "The seller accepts and moves the BCH into this trade's contract.":
    'El vendedor acepta y mueve los BCH al contrato de esta operación.',
  'Verified on the network': 'Verificado en la red',
  'Your browser checks the deposit.': 'Tu navegador comprueba el depósito.',
  'Watch the check finish.': 'Mira cómo termina la comprobación.',
  'Your browser rebuilds the contract and watches the network for 5 quiet seconds: Safe at 0-conf.':
    'Tu navegador reconstruye el contrato y observa la red durante 5 segundos tranquilos: seguro con 0 confirmaciones.',
  'Your turn, with a clock': 'Tu turno, con reloj',
  'Pay and mark as paid.': 'Paga y marca como pagado.',
  "Send the money with the seller's method before the clock runs out, then tap Mark as paid.":
    'Envía el dinero con el medio del vendedor antes de que se acabe el tiempo y después toca «Marcar como pagado».',
  'The seller sets the time to pay. If it runs out before you mark as paid, the arbiter sends the coins back to the seller.':
    'El vendedor fija el plazo para pagar. Si se acaba antes de que marques el pago, el árbitro le devuelve las monedas al vendedor.',
  'The seller releases.': 'El vendedor libera.',
  'Wait while the seller checks their bank app.': 'Espera mientras el vendedor revisa la aplicación de su banco.',
  'When the seller signs, the contract pays the BCH to your wallet.':
    'Cuando el vendedor firma, el contrato paga los BCH a tu billetera.',
  'The BCH is yours.': 'Los BCH son tuyos.',

  // The simulated phone
  'Create an offer': 'Crear una oferta',
  'Sell BCH': 'Vender BCH',
  'Price:': 'Precio:',
  'over market': 'sobre el mercado',
  'Example:': 'Ejemplo:',
  'per BCH': 'por BCH',
  'Amount to sell (BCH)': 'Monto a vender (BCH)',
  'How buyers can pay you': 'Cómo pueden pagarte',
  'Time for buyers to pay (you choose)': 'Plazo para pagar (lo eliges tú)',
  'Bank transfer': 'Transferencia bancaria',
  'Cash in person': 'Efectivo en persona',
  'Payment app': 'Aplicación de pagos',
  'Publish offer': 'Publicar oferta',
  'Simulated wallet': 'Billetera simulada',
  'In the real app, your Bitcoin Cash wallet opens here and asks you to approve. Once you are signed in, it only asks when coins move.':
    'En la aplicación real, aquí se abre tu billetera de Bitcoin Cash y te pide que apruebes. Una vez que iniciaste sesión, solo lo pide cuando se mueven monedas.',
  Approve: 'Aprobar',
  Back: 'Volver',
  'Your offer is live': 'Tu oferta está publicada',
  Offer: 'Oferta',
  'Waiting for buyers': 'Esperando compradores',
  'No coins are locked until someone takes your offer.':
    'No se bloquea ninguna moneda hasta que alguien tome tu oferta.',
  'Time left to accept': 'Tiempo para aceptar',
  'Accept buyer': 'Aceptar comprador',
  'Lock the coins': 'Bloquea las monedas',
  Trade: 'Operación',
  'You lock': 'Bloqueas',
  'Time left to lock': 'Tiempo para bloquear',
  'Where do they go?': '¿Adónde van?',
  'Into a contract made only for this trade. It can pay the buyer or return the coins to you.':
    'A un contrato hecho solo para esta operación. Puede pagarle al comprador o devolverte las monedas.',
  'Waiting for payment': 'Esperando el pago',
  '✓ Locked in the contract': '✓ Bloqueado en el contrato',
  'Only the buyer or you can receive the coins now.': 'Ahora solo el comprador o tú pueden recibir las monedas.',
  'Waiting for the buyer to pay': 'Esperando que el comprador pague',
  'The buyer marked it as paid': 'El comprador lo marcó como pagado',
  'Check your account before you release.': 'Revisa tu cuenta antes de liberar.',
  'Check the payment': 'Revisar el pago',
  'Release the coins': 'Libera las monedas',
  'Only your bank app counts': 'Solo cuenta la aplicación de tu banco',
  "Don't trust screenshots or messages. Once you release, the coins can't come back.":
    'No confíes en capturas ni mensajes. Una vez que liberas, las monedas no pueden volver.',
  'I opened my bank app, not a screenshot': 'Abrí la aplicación de mi banco, no una captura',
  'I see exactly': 'Veo exactamente',
  'from this buyer': 'de este comprador',
  'Buy BCH': 'Comprar BCH',
  'How much BCH do you want?': '¿Cuántos BCH quieres?',
  'You pay': 'Pagas',
  'Take offer': 'Tomar oferta',
  'Waiting for the seller to accept': 'Esperando que el vendedor acepte',
  "Don't pay anything yet.": 'Todavía no pagues nada.',
  'Waiting for the seller to lock the coins': 'Esperando que el vendedor bloquee las monedas',
  '✓ The seller locked the coins': '✓ El vendedor bloqueó las monedas',
  "They are in this trade's contract.": 'Están en el contrato de esta operación.',
  'Check the deposit': 'Comprobar el depósito',
  "The seller moved the coins into this trade's contract.":
    'El vendedor movió las monedas al contrato de esta operación.',
  'Checking the deposit…': 'Comprobando el depósito…',
  s: 's',
  'Your browser is watching the network on its own.': 'Tu navegador está observando la red por su cuenta.',
  '✓ Safe at 0-conf': '✓ Seguro con 0 confirmaciones',
  'The coins are really there. You can pay now.': 'Las monedas están ahí de verdad. Ya puedes pagar.',
  'Continue to payment': 'Continuar al pago',
  'Pay the seller': 'Págale al vendedor',
  'Time left to pay (set by the seller)': 'Tiempo para pagar (lo fija el vendedor)',
  'Send exactly': 'Envía exactamente',
  'I sent the payment from my own account': 'Envié el pago desde mi propia cuenta',
  'Mark as paid': 'Marcar como pagado',
  'Waiting for the seller to release': 'Esperando que el vendedor libere',
  'The seller is checking their bank app.': 'El vendedor está revisando la aplicación de su banco.',
  '✓ The seller released the coins': '✓ El vendedor liberó las monedas',
  'The contract is paying your wallet.': 'El contrato le está pagando a tu billetera.',
  'See the result': 'Ver el resultado',
  Done: 'Listo',
  'Trade completed': 'Operación completada',
  'On-chain': 'En la cadena',
  'In the real app, this links to the payout in a block explorer.':
    'En la aplicación real, esto enlaza al pago en un explorador de bloques.',
  'Now try buying': 'Ahora prueba comprar',
  'Now try selling': 'Ahora prueba vender',
  'Start again': 'Empezar de nuevo',
  'Time ran out': 'Se acabó el tiempo',
  'Coins back to the seller': 'Monedas de vuelta al vendedor',
  'The arbiter returns them automatically. Nobody loses anything.':
    'El árbitro se las devuelve automáticamente. Nadie pierde nada.',
  'Or: open a dispute': 'O bien: abrir una disputa',
  'If something else went wrong, either side can open a dispute. An arbiter decides who gets the coins.':
    'Si salió mal otra cosa, cualquiera de los dos puede abrir una disputa. Un árbitro decide quién recibe las monedas.',
  '← Back to the trade': '← Volver a la operación',
  'Margin over market price': 'Margen sobre el precio de mercado',

  // Questions?
  'Still unsure? Start with the demo trade: real BCH, real contract, and no money of yours moves.':
    '¿Todavía tienes dudas? Empieza por la operación de demostración: BCH reales, contrato real, y no se mueve dinero tuyo.',
  'Getting started': 'Primeros pasos',
  Safety: 'Seguridad',
  'Costs and the demo': 'Costos y la demostración',
  'Do I need Bitcoin Cash to buy?': '¿Necesito Bitcoin Cash para comprar?',
  'No. To buy you only need a compatible Bitcoin Cash wallet to receive the coins. You pay the seller in fiat money.':
    'No. Para comprar solo necesitas una billetera de Bitcoin Cash compatible donde recibir las monedas. Le pagas al vendedor en dinero fíat.',
  'Do I need to create an account?': '¿Tengo que crear una cuenta?',
  'No. Connecting your wallet is the only sign-in. There are no accounts, passwords or e-mail addresses.':
    'No. Conectar tu billetera es el único inicio de sesión. No hay cuentas, contraseñas ni direcciones de correo.',
  'How do I pay or get paid?': '¿Cómo pago o cobro?',
  'Each offer lists the payment methods the seller accepts — for example a bank transfer or cash in person. The payment happens outside Campfire, directly between the two of you.':
    'Cada oferta indica los medios de pago que acepta el vendedor, por ejemplo una transferencia bancaria o efectivo en persona. El pago ocurre fuera de Campfire, directamente entre ustedes dos.',
  'Who holds the coins during a trade?': '¿Quién guarda las monedas durante una operación?',
  'A contract on the Bitcoin Cash network. It can only pay the buyer or return the coins to the seller. Campfire cannot move them.':
    'Un contrato en la red de Bitcoin Cash. Solo puede pagarle al comprador o devolverle las monedas al vendedor. Campfire no puede moverlas.',
  "What if the buyer doesn't pay in time?": '¿Y si el comprador no paga a tiempo?',
  'The seller sets the time to pay. If it runs out before the buyer marks the trade as paid, the arbiter automatically sends the coins back to the seller. Either side can also open a dispute.':
    'El vendedor fija el plazo para pagar. Si se acaba antes de que el comprador marque la operación como pagada, el árbitro le devuelve automáticamente las monedas al vendedor. Cualquiera de los dos también puede abrir una disputa.',
  'What if the other person disappears?': '¿Y si la otra persona desaparece?',
  'Either of you can open a dispute, and an arbiter named in the offer decides who gets the coins. The arbiter can never keep them. And if everyone disappears, after 14 days the seller can take the coins back alone.':
    'Cualquiera de los dos puede abrir una disputa, y un árbitro indicado en la oferta decide quién recibe las monedas. El árbitro nunca puede quedárselas. Y si todos desaparecen, después de 14 días el vendedor puede recuperar las monedas por su cuenta.',
  'When does my wallet ask me to sign?': '¿Cuándo me pide firmar mi billetera?',
  'Once to sign in, the first time you connect in a browser: it is free and moves no funds. After that, only when coins move: publishing a sell offer, locking coins, releasing them, or cancelling. Buttons that open your wallet say so.':
    'Una vez para iniciar sesión, la primera vez que conectas en un navegador: es gratis y no mueve fondos. Después, solo cuando se mueven monedas: al publicar una oferta de venta, bloquear monedas, liberarlas o cancelar. Los botones que abren tu billetera lo indican.',
  'How much does it cost?': '¿Cuánto cuesta?',
  'Nothing for the buyer. The seller pays the network fee and a small fee to the arbiter and, at market price, to the price oracle: 0.5% each today. The fees are shown before anything is locked, and Campfire pays the fee to publish a buy offer.':
    'Nada para el comprador. El vendedor paga la comisión de la red y una pequeña tarifa al árbitro y, con precio de mercado, al oráculo de precios: hoy, 0,5 % cada una. Las tarifas se muestran antes de bloquear nada, y Campfire paga la comisión para publicar una oferta de compra.',
  'What does “Simulated” mean?': '¿Qué significa «Simulado»?',
  'In demo trades the other person is Campfire’s demo bot, not a real user, and the bank payment is not real. The Bitcoin Cash, the contract and everything marked “On-chain” are real transactions on mainnet you can check.':
    'En las operaciones de demostración la otra persona es el bot de demostración de Campfire, no un usuario real, y el pago bancario no es real. Los Bitcoin Cash, el contrato y todo lo marcado «En la cadena» son transacciones reales en la red principal que puedes comprobar.',
  'Can I trade PUSD?': '¿Puedo operar con PUSD?',
  'Yes. PUSD is a dollar token on Bitcoin Cash (1 PUSD stays close to 1 US dollar). Offers can sell or buy Bitcoin Cash or PUSD.':
    'Sí. PUSD es un token en dólares sobre Bitcoin Cash (1 PUSD se mantiene cerca de 1 dólar estadounidense). Las ofertas pueden vender o comprar Bitcoin Cash o PUSD.',

  // Closing
  'Clear trades. Connected people.': 'Operaciones claras. Personas conectadas.',
  'Try a whole trade with real Bitcoin Cash and a real contract on mainnet. Only two things are simulated: the other side, played by a demo bot, and the bank payment.':
    'Prueba una operación completa con Bitcoin Cash real y un contrato real en la red principal. Solo hay dos cosas simuladas: la otra parte, que es un bot de demostración, y el pago bancario.',
};

// Texts the simulated phone builds with numbers in them.
export const ES_PATTERNS: [RegExp, (...groups: string[]) => string][] = [
  [/^Step (\d+) of (\d+)$/, (a, b) => `Paso ${a} de ${b}`],
  [/^(\d+) min$/, (a) => `${a} min`],
  [/^(\d+) min to pay$/, (a) => `${a} min para pagar`],
  [/^Sign to publish your offer$/, () => 'Firma para publicar tu oferta'],
  [/^Sign to lock (.+) BCH$/, (a) => `Firma para bloquear ${a} BCH`],
  [/^Sign to release the coins to the buyer$/, () => 'Firma para liberarle las monedas al comprador'],
  [/^A buyer wants (.+) BCH$/, (a) => `Un comprador quiere ${a} BCH`],
  [/^They will pay$/, () => 'Pagará'],
  [/^by bank transfer\.$/, () => 'por transferencia bancaria.'],
  [/^by cash in person\.$/, () => 'en efectivo en persona.'],
  [/^by payment app\.$/, () => 'por aplicación de pagos.'],
  [/^Lock (.+) BCH$/, (a) => `Bloquear ${a} BCH`],
  [/^They have up to (\d+) minutes\.$/, (a) => `Tiene hasta ${a} minutos.`],
  [/^Release (.+) BCH to the buyer$/, (a) => `Liberar ${a} BCH al comprador`],
  [/^You sold (.+) BCH\.$/, (a) => `Vendiste ${a} BCH.`],
  [/^(.+) BCH is in your wallet\.$/, (a) => `${a} BCH ya están en tu billetera.`],
  [/^(.+) · details shared privately$/, (a) => `${ES_TEXT[a] ?? a} · datos compartidos en privado`],
];

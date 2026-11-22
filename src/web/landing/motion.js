// The landing page's motion: reveal on scroll, the header and progress bar, the contract map, the simulated
// trade on the phone and the FAQ tabs. Ported from Aye's sketch (design/landing.src.html) with these changes:
// it works inside `root` instead of the whole document, it leaves out the sketch's design-notes switch, it
// stops everything it started when the page unmounts, and the payment-method chips keep their English name in a
// data attribute so the Spanish page (translate.ts) can translate their labels.

export function startLanding(root) {
  // Every observer and timer the page starts, so the cleanup at the end can stop them all.
  const observers = [];
  const pending = new Set();
  class Observer extends IntersectionObserver {
    constructor(callback, options) {
      super(callback, options);
      observers.push(this);
    }
  }
  const setTimeout = (fn, ms) => {
    const id = window.setTimeout(() => { pending.delete(id); fn(); }, ms);
    pending.add(id);
    return id;
  };
  const setInterval = (fn, ms) => {
    const id = window.setInterval(fn, ms);
    pending.add(id);
    return id;
  };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;
  const desk = matchMedia('(min-width: 901px)');
  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];
  const icon = (id) => `<svg class="ic"><use href="#i-${id}"/></svg>`;


  /* Mobile menu */
  const menu = $('#navMenu'), links = $('#navLinks');
  menu.addEventListener('click', () => { const o = links.classList.toggle('open'); menu.setAttribute('aria-expanded', String(o)); });
  links.addEventListener('click', (e) => { if (e.target.tagName === 'A') { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });

  /* Reveal */
  const io = new Observer((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .05, rootMargin: '0px 0px -4% 0px' });
  $$('.rv, .scene').forEach((el) => io.observe(el));

  /* Why Campfire?: draw the orbit on arrival */
  const why = $('#why');
  new Observer((es, o) => es.forEach((e) => { if (e.isIntersecting) { why.classList.add('in-view'); o.disconnect(); } }), { threshold: .2 }).observe(why);
  const problem = $('#problem'), contractSec = $('#contract');
  new Observer((es, o) => es.forEach((e) => { if (e.isIntersecting) { contractSec.classList.add('in-view'); o.disconnect(); } }), { threshold: .1 }).observe(contractSec);
  new Observer((es, o) => es.forEach((e) => { if (e.isIntersecting) { problem.classList.add('in-view'); o.disconnect(); } }), { threshold: .15 }).observe(problem);

  /* Scroll-driven chrome and scenes */
  const nav = $('#nav'), bar = $('#progress'), hero = $('#hero'), closing = $('#closing'), rail = $('#rail');
  const railLinks = $$('a', rail).map((a) => [a, $(a.getAttribute('href'))]);
  const navMap = $$('.nav-links a').map((a) => [a, $(a.getAttribute('href'))]);
  const current = (pairs) => { let hit = null; pairs.forEach(([a, s]) => { if (s && s.getBoundingClientRect().top < innerHeight * .4) hit = a; }); return hit; };
  const pick = (els, key) => { let n = +els[0].dataset[key]; els.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight * .55) n = +el.dataset[key]; }); return n; };
  const live = (el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight * .6 && r.bottom > innerHeight * .4; };
  const onScroll = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', h > 0 ? (scrollY / h).toFixed(4) : 0);
    nav.classList.toggle('scrolled', scrollY > hero.offsetHeight - 120);
    nav.classList.toggle('calm', closing.getBoundingClientRect().top < innerHeight * .8);
    rail.classList.toggle('show', scrollY > innerHeight * .5);
    const r = current(railLinks); railLinks.forEach(([a]) => a.classList.toggle('on', a === r));
    const n = current(navMap); navMap.forEach(([a]) => a.classList.toggle('on', a === n));
    if (!reduce) { const wr = why.getBoundingClientRect(); why.style.setProperty('--o', Math.max(-1, Math.min(1, (innerHeight / 2 - wr.top - wr.height / 2) / innerHeight)).toFixed(3)); const pr = problem.getBoundingClientRect(); const st = problem.querySelector('.stage'), grid = problem.querySelector('.problem-grid'); grid.style.setProperty('--cy', (st.getBoundingClientRect().top - grid.getBoundingClientRect().top + st.offsetHeight * .46) + 'px'); const cr = contractSec.getBoundingClientRect(); contractSec.style.setProperty('--e', Math.max(0, Math.min(1, -cr.top / Math.max(1, cr.height - innerHeight))).toFixed(3)); problem.style.setProperty('--c', Math.max(-1, Math.min(1, (innerHeight / 2 - pr.top - pr.height / 2) / innerHeight)).toFixed(3)); }
    if (!reduce && finePointer) hero.style.setProperty('--sy', Math.min(scrollY / innerHeight, 1).toFixed(3));
    if (desk.matches) { if (live(ecoMap.closest('section'))) syncEco(); }
  };
  if (!reduce && finePointer) {
    hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); hero.style.setProperty('--mx', ((e.clientX - r.left) / r.width - .5).toFixed(3)); hero.style.setProperty('--my', ((e.clientY - r.top) / r.height - .5).toFixed(3)); });
    hero.addEventListener('pointerleave', () => { hero.style.setProperty('--mx', 0); hero.style.setProperty('--my', 0); });
    $$('.ben').forEach((c) => {
      c.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; c.style.transform = `perspective(800px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(-4px)`; });
      c.addEventListener('pointerleave', () => { c.style.transform = ''; });
    });
  }

  /* ===== 4 How does it work? ===== */
  const ecoMap = $('#ecoMap'), coin = $('#mapCoin'), ecoSteps = $$('.eco-step'), exitItems = $$('#exitList li');
  const P = { seller: [13, 46], buyer: [87, 46], arbiter: [50, 9], center: [50, 49] };
  const fly = (path, ms = 1500, stay = false) => {
    if (reduce || !coin.animate) return;
    coin.animate(path.map(([x, y], i) => ({ left: x + '%', top: y + '%', opacity: i === 0 || (i === path.length - 1 && !stay) ? 0 : 1, offset: i / (path.length - 1) })), { duration: ms, easing: 'cubic-bezier(.65,0,.35,1)' });
  };
  const EXITS = { release: [P.center, P.center, P.buyer, P.buyer], refund: [P.center, P.center, P.seller, P.seller], arbitrate: [P.center, P.center, P.center, P.buyer, P.buyer] /* the arbiter only decides: the coins never go to them */, reclaim: [P.center, P.center, [40, 70], [24, 68], P.seller, P.seller] };
  let exT = null, exI = 0;
  const showExit = () => { const k = Object.keys(EXITS)[exI++ % 4]; ecoMap.dataset.exit = k; exitItems.forEach((li) => li.classList.toggle('on', li.dataset.exit === k)); fly(EXITS[k], 1600); };
  const startExits = () => { if (exT) return; showExit(); if (!reduce) exT = setInterval(showExit, 2400); };
  const stopExits = () => { clearInterval(exT); exT = null; delete ecoMap.dataset.exit; exitItems.forEach((li) => li.classList.remove('on')); };
  let curEco = 0;
  const setEco = (n) => {
    if (n === curEco) return;
    const prev = curEco; curEco = n; ecoMap.dataset.step = n;
    ecoSteps.forEach((s) => s.classList.toggle('on', +s.dataset.eco === n));
    $$('[data-s]', ecoMap).forEach((el) => { const show = +el.dataset.s <= n; if (el.classList.contains('node')) el.classList.toggle('show', show); else el.style.opacity = show ? 1 : 0; });
    coin.style.left = P.center[0] + '%'; coin.style.top = P.center[1] + '%'; coin.style.opacity = n >= 2 && n < 5 ? 1 : 0;
    if (n === 2 && prev < 2) fly([P.seller, P.seller, P.center, P.center], 1300, true);
    n === 5 ? startExits() : stopExits();
  };
  const syncEco = () => setEco(pick(ecoSteps, 'eco'));
  new Observer((es, o) => es.forEach((e) => { if (e.isIntersecting) { setEco(desk.matches ? Math.max(1, pick(ecoSteps, 'eco')) : 5); o.disconnect(); } }), { threshold: .25 }).observe(ecoMap);

  /* ===== 5 Want to try a trade? ===== */
  const trade = $('#how'), scr = $('#simScreen'), stepper = $('#stepper'), whatIfBtn = $('#whatIf'), phoneCol = $('#phoneCol');
  const MARKET = 420; // Example only: a fictional USD price per BCH.
  const fmtUsd = (n) => 'USD ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBch = (n) => (Math.round(n * 1e8) / 1e8).toString();
  const pad = (n) => String(n).padStart(2, '0');
  const METHODS = ['Bank transfer', 'Cash in person', 'Payment app'];
  let way = 'sell', step = -1, timers = [], st = {};
  const later = (fn, ms) => timers.push(setTimeout(fn, reduce ? Math.min(ms, 300) : ms));
  const clear = () => { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; };
  const countdown = (el, from) => { let s = from; const t = () => { el.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; s = Math.max(0, s - 1); }; t(); timers.push(setInterval(t, 1000)); };

  /* Four real paths: buy or sell, by taking an offer or by publishing one. The phone copies the app's own screens
     (offers list, create offer, the trade's action card with its four named steps). Example data only. */
  const FLOWS = {
    'buy-take': [
      ['act', 'Your turn', 'Take a sell offer', 'Pick an offer and type how much you pay. Taking an offer is free.', 'The price is signed and held 10 minutes for the seller to accept. You need no BCH, only a wallet to receive.'],
      ['wait', 'Waiting', 'The seller accepts and locks the BCH', 'Wait. Don\'t pay yet.', 'The seller has up to 10 minutes to accept, then 30 to lock the coins in this trade\'s contract.'],
      ['chain', 'On-chain', 'Your browser checks the lock', 'Watch the check finish.', 'Your browser rebuilds the contract and waits 5 seconds for a double-spend proof: Safe at 0-conf.'],
      ['act', 'Your turn', 'Send the payment, mark it as paid', 'Pay with the seller\'s method, then tap I\'ve sent the payment. No signature needed.', 'If the time to pay ends first, the arbiter returns the coins to the seller. You aren\'t charged.'],
      ['chain', 'On-chain', 'Receive the BCH', 'Nothing. The seller checks their account and releases.', 'The contract pays your wallet. You can use the BCH right away.'],
    ],
    'buy-publish': [
      ['act', 'Your turn', 'Publish a buy offer', 'Choose the coin, your price, the amounts and how you can pay.', 'No signature and no BCH needed: Campfire publishes it on-chain and pays the fee.'],
      ['act', 'Your turn', 'A seller answers: accept', 'Check the amount and accept within 10 minutes. Free, no signature.', 'Accepting fixes the trade. The seller then has 30 minutes to lock the coins.'],
      ['chain', 'On-chain', 'The seller locks, your browser checks', 'Wait. Don\'t pay yet.', 'Once the coins are locked, your browser checks the deposit on its own: Safe at 0-conf.'],
      ['act', 'Your turn', 'Send the payment, mark it as paid', 'Pay with the seller\'s method, then tap I\'ve sent the payment. No signature needed.', 'If the time to pay ends first, the arbiter returns the coins to the seller. You aren\'t charged.'],
      ['chain', 'On-chain', 'Receive the BCH', 'Nothing. The seller checks their account and releases.', 'The contract pays your wallet. You can use the BCH right away.'],
    ],
    'sell-publish': [
      ['act', 'Your turn', 'Publish a sell offer', 'Set your price against the market, the amounts, how buyers pay you and the time to pay.', 'Your wallet signs once to publish. Nothing is locked yet: an offer is only an announcement.'],
      ['act', 'Your turn', 'A buyer takes it: accept and lock', 'Accept within 10 minutes, then lock the BCH within 30. Your wallet signs.', 'The coins go into a contract made only for this trade. Your payment details reach the buyer encrypted.'],
      ['wait', 'Waiting', 'The buyer pays you', 'Nothing. The buyer pays you outside Campfire.', 'If the time to pay ends unpaid, the arbiter returns the coins to you.'],
      ['time', 'Check first', 'Check your account, then release', 'Confirm the exact amount in your bank app, not a screenshot. Then release: your wallet signs.', 'The contract pays the buyer. It can\'t be undone.'],
      ['chain', 'On-chain', 'Trade completed', 'Nothing else to do.', 'The release is a real transaction anyone can check.'],
    ],
    'sell-take': [
      ['act', 'Your turn', 'Take a buy offer', 'Pick a buyer\'s offer and how much you sell. Nothing is locked yet.', 'The buyer has 10 minutes to accept your request.'],
      ['act', 'Your turn', 'The buyer accepts: lock the BCH', 'Lock within 30 minutes. Your wallet signs.', 'The coins go into this trade\'s contract, and your payment details go with the deposit, encrypted.'],
      ['wait', 'Waiting', 'The buyer pays you', 'Nothing. The buyer pays you outside Campfire.', 'If the time to pay ends unpaid, the arbiter returns the coins to you.'],
      ['time', 'Check first', 'Check your account, then release', 'Confirm the exact amount in your bank app, not a screenshot. Then release: your wallet signs.', 'The contract pays the buyer. It can\'t be undone.'],
      ['chain', 'On-chain', 'Trade completed', 'Nothing else to do.', 'The release is a real transaction anyone can check.'],
    ],
  };
  let mode = 'take';
  const flowKey = () => `${way}-${mode}`;
  const modeBox = $('#modes');
  const MODE_LABELS = { buy: ['Take a sell offer', 'Publish a buy offer'], sell: ['Take a buy offer', 'Publish a sell offer'] };
  const buildSteps = () => {
    stepper.innerHTML = FLOWS[flowKey()].map(([c, lbl, h, you, sys], i) => `<li data-w="${i}"><button type="button"><span class="n">${i + 1}</span><span class="ttl">${h}</span><span class="pill ${c}">${lbl}</span></button><div class="body"><dl><div><dt>What you do</dt><dd>${you}</dd></div><div><dt>What happens</dt><dd>${sys}</dd></div></dl></div></li>`).join('');
    $$('li', stepper).forEach((li) => $('button', li).onclick = () => go(+li.dataset.w));
    const [t, p] = MODE_LABELS[way];
    $$('button', modeBox).forEach((b) => { b.textContent = b.dataset.mode === 'take' ? t : p; b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    modeBox.dataset.mode = mode;
  };
  const go = (n) => {
    if (n === step) return;
    step = n; clear();
    $$('li', stepper).forEach((li) => { const i = +li.dataset.w; li.classList.toggle('on', i === n); li.classList.toggle('done', i < n); });
    const pay = (way === 'buy' && n === 3) || (way === 'sell' && n === 2);
    whatIfBtn.classList.toggle('show', pay);
    whatIfBtn.textContent = way === 'buy' ? 'What if I don\'t pay in time?' : 'What if the buyer doesn\'t pay?';
    SCREENS[flowKey()][n]();
  };
  const next = () => go(step + 1);

  // The app's pieces, drawn small: provenance tags, the four named steps of a trade, the action card, the timeline.
  const tag = (k, txt) => `<span class="r-tag ${k}">${txt || { chain: 'On-chain', off: 'Off-chain', sim: 'Simulated' }[k]}</span>`;
  const LABELS = { buy: ['Confirm', 'Lock', 'Pay', 'Receive'], sell: ['Accept', 'Lock', 'Paid', 'Release'] };
  const steps4 = (cur, turn) => `<ol class="r-steps" data-turn="${turn}">${LABELS[way].map((l, i) => `<li class="${i < cur ? 'd' : i === cur ? 'c' : ''}">${l}</li>`).join('')}</ol>`;
  const action = (cur, turn, title, inner = '') => `<div class="r-card r-action">${steps4(cur, turn)}<span class="r-turn ${turn}">${turn === 'you' ? 'Your turn' : 'Waiting'}</span><div class="r-h">${title}</div>${inner}</div>`;
  const shield = (txt) => `<p class="r-shield"><svg class="ic"><use href="#i-lock"/></svg><span>${txt}</span></p>`;
  const tl = (items) => `<ol class="r-tl">${items.map(([t, k]) => `<li><i>✓</i><span>${t}</span>${k ? tag(k) : ''}</li>`).join('')}</ol>`;
  const page = (crumb, title, sub = '') => `<div class="app-bar"><span>${crumb}</span>${tag('sim', 'Example')}</div><div class="app-title">${title}</div>${sub}`;
  const sheet = (cls, html, onOk) => {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const sh = document.createElement('div'); sh.className = 'sheet ' + cls; sh.innerHTML = html;
    scr.append(scrim, sh);
    const close = () => { scrim.remove(); sh.remove(); };
    const [ok, back] = $$('button', sh);
    ok.focus();
    ok.onclick = () => { close(); onOk && onOk(); };
    if (back) back.onclick = close;
    scrim.onclick = close;
  };
  const wallet = (what, onOk) => sheet('dark', `<span class="pill neutral" style="align-self:flex-start;background:rgba(138,150,179,.14);color:var(--mist)">Simulated wallet</span><span class="t">Sign to ${what}</span><span class="muted">In the app, your Bitcoin Cash wallet opens here. After signing in once, it only asks when coins move.</span><button class="ab" type="button">Approve</button><button class="ab ghost" type="button" style="color:var(--pearl);border-color:rgba(244,243,238,.35)">Back</button>`, onOk);
  whatIfBtn.onclick = () => sheet('light', `<span class="t">The payment window ended</span><div class="state-box neutral"><b>The arbiter returned the coins to the seller</b><span>The trade was not marked as paid in time. The buyer was not charged.</span></div><div class="state-box arb"><b>Something wrong?</b><span>Either side can open a dispute. The arbiter decides: the coins go to the buyer or back to the seller, never to the arbiter.</span></div><button class="ab ghost" type="button">← Back to the trade</button>`);

  const OFFERS = { buy: [{ n: 'Calm Lantern', m: 'Bank transfer', w: 60, p: 2.5, t: 8 }, { n: 'Swift Heron', m: 'Payment app', w: 30, p: 1.5, t: 3 }, { n: 'Pale Ember', m: 'Cash in person', w: 15, p: 3, t: 0 }],
    sell: [{ n: 'Quiet Fern', m: 'Bank transfer', w: 60, p: -1, t: 5 }, { n: 'North Wren', m: 'Payment app', w: 30, p: -2, t: 1 }] };
  const price = (p) => MARKET * (1 + p / 100);
  const offerRows = (list, verb) => list.map((o, i) => `<button type="button" class="r-offer" aria-pressed="${st.pick === i}"><span class="av">${o.n.split(' ').map((w) => w[0]).join('')}</span><span class="who"><b>${o.n}</b><small>${verb} · ${o.t ? o.t + (o.t === 1 ? ' trade' : ' trades') : 'No trades yet'}</small></span><span class="pr mono">${fmtUsd(price(o.p))}</span><span class="meta">market ${o.p >= 0 ? '+' : ''}${o.p}% · ${o.m} · ${o.w} min to pay</span></button>`).join('');
  const pickOffers = (upd) => $$('.r-offer', scr).forEach((b, i) => b.onclick = () => { st.pick = i; $$('.r-offer', scr).forEach((o, j) => o.setAttribute('aria-pressed', String(j === i))); upd(); });
  const paymentDetails = () => `<div class="r-simbox"><span class="r-simlbl">Demo payment details. Do not send any money.</span><dl class="cf"><dt>Amount</dt><dd class="mono">${fmtUsd(st.fiat)}</dd><dt>Method</dt><dd>${st.method}</dd><dt>Reference</dt><dd class="mono">CF-4821</dd></dl></div>`;

  // Buyer screens shared by both ways of buying
  const bCheck = (lead) => {
    scr.innerHTML = `${page('Trade', `Buy ${fmtBch(st.amount)} BCH`)}${action(1, 'other', 'Checking the lock…', `<p class="muted">Bitcoin Cash nodes publish a double-spend proof within seconds if anyone tries to spend these coins twice. Ready in about <b class="mono" id="bS">5</b> s.</p>`)}${tl(lead)}`;
    let s = 5; const t = setInterval(() => { s -= 1; const el = $('#bS'); if (el) el.textContent = s; if (s <= 0) { clearInterval(t); $('.r-action', scr).outerHTML = action(2, 'you', 'Safe at 0-conf', `<p class="muted">The locked coins reached the network and no double-spend attempt was seen in 5 seconds. You can pay now.</p><button class="ab" type="button" id="bNx">See the payment details</button>`); $('#bNx').onclick = next; } }, reduce ? 120 : 1000); timers.push(t);
  };
  const bPay = () => {
    scr.innerHTML = `${page('Trade', `Buy ${fmtBch(st.amount)} BCH`)}${action(2, 'you', 'Send the payment, then mark it as paid', `${shield('The seller\'s coins are locked for you. They can only go to you or back to the seller.')}<p class="r-dead"><b class="mono" id="bT"></b> left to mark as paid</p>${paymentDetails()}<button class="ab" type="button" id="bMark">I've sent the payment</button><span class="r-note">No signature needed</span>`)}`;
    countdown($('#bT'), st.win * 60 - 1);
    $('#bMark').onclick = () => sheet('light', `<span class="t">Did ${fmtUsd(st.fiat)} leave your account?</span><span class="muted">Mark it only once the transfer has gone out. The seller is asked to check their account and release the coins, and this step cannot be undone.</span><button class="ab" type="button">Yes, I sent it</button><button class="ab ghost" type="button">Not yet</button>`, next);
  };
  const bReceive = () => {
    scr.innerHTML = `${page('Trade', `Buy ${fmtBch(st.amount)} BCH`)}${action(3, 'other', 'Waiting for the seller to release', `<p class="muted"><span class="spin"></span>You marked the payment as sent. When the seller confirms it, ${fmtBch(st.amount)} BCH go to your wallet.</p>`)}`;
    later(() => done(`Bought ${fmtBch(st.amount)} BCH`, `The seller released ${fmtBch(st.amount)} BCH to your wallet. You can use them right away: on Bitcoin Cash there is no need to wait for a block.`, 'sell', 'Now try selling'), 2200);
  };
  // Seller screens shared by both ways of selling
  const sWaitPay = () => {
    scr.innerHTML = `${page('Trade', `Sell ${fmtBch(st.amount)} BCH`)}${action(2, 'other', 'Waiting for the buyer to pay', `<p class="r-dead"><b class="mono" id="sT"></b> left for the buyer to mark it as paid</p><p class="muted">If it runs out, the arbiter returns the BCH to you.</p>`)}${tl([['You locked the BCH', 'chain'], ['Payment details encrypted for the buyer', 'off']])}`;
    countdown($('#sT'), st.win * 60 - 1);
    later(() => { $('.r-action', scr).outerHTML = action(3, 'you', 'Buyer marked the payment as sent', `<p class="muted">Check your own account before you release.</p><button class="ab" type="button" id="sChk">Check the payment</button>`); $('#sChk').onclick = next; }, 2400);
  };
  const sRelease = () => {
    scr.innerHTML = `${page('Trade', `Sell ${fmtBch(st.amount)} BCH`)}${action(3, 'you', 'Check your account, then release', `<p class="muted">Only your bank app counts. Once you release, the coins can't come back.</p><label class="tick"><input type="checkbox" id="c1">I opened my bank app, not a screenshot</label><label class="tick"><input type="checkbox" id="c2">I see exactly <b class="mono">&nbsp;${fmtUsd(st.fiat)}&nbsp;</b> from this buyer</label><button class="ab" type="button" id="sRel" disabled>Release ${fmtBch(st.amount)} BCH</button><span class="r-note">Signs in your wallet</span>`)}`;
    const chk = () => { $('#sRel').disabled = !($('#c1').checked && $('#c2').checked); };
    $('#c1').onchange = chk; $('#c2').onchange = chk;
    $('#sRel').onclick = () => wallet('release the coins to the buyer', next);
  };
  const sDone = () => done(`Sold ${fmtBch(st.amount)} BCH`, `You released ${fmtBch(st.amount)} BCH to the buyer. The release is a real transaction anyone can check.`, 'buy', 'Now try buying');
  const lockBox = () => `<div class="r-card r-soft"><div class="row"><span class="muted">You lock</span><b class="mono">${fmtBch(st.amount)} BCH</b></div><span class="r-small">The same transaction pays the service fees to the arbiter and the price oracle, and a small network fee. They are shown before you sign.</span></div>`;

  const SCREENS = {
    'buy-take': [
      () => {
        st = { pick: st.pick ?? 0, amount: st.amount ?? 0.5 };
        scr.innerHTML = `${page('Offers', 'Buy BCH')}<div class="r-tabs"><span class="on">Buy</span><span>Sell</span></div><div class="r-list">${offerRows(OFFERS.buy, 'Seller')}</div>
          <div class="field"><label for="bAmt">How much BCH do you want?</label><input id="bAmt" type="number" min="0.001" max="5" step="0.1" value="${st.amount}"></div>
          <div class="r-card r-soft"><div class="row"><span class="muted">You pay</span><b class="mono" id="bPay"></b></div><span class="r-small">Final price signed when you take it, then held 10 minutes for the seller to accept.</span></div>
          <button class="ab" type="button" id="bGo">Take this offer</button>`;
        const upd = () => { const o = OFFERS.buy[st.pick]; st.fiat = price(o.p) * st.amount; st.win = o.w; st.method = o.m; $('#bPay').textContent = fmtUsd(st.fiat); $('#bGo').disabled = !(st.amount > 0); };
        pickOffers(upd); $('#bAmt').oninput = (e) => { st.amount = +e.target.value; upd(); }; $('#bGo').onclick = next; upd();
      },
      () => {
        scr.innerHTML = `${page('Trade', `Buy ${fmtBch(st.amount)} BCH`)}${action(0, 'other', 'Waiting for the seller to accept', `<p class="r-dead"><b class="mono" id="bQ"></b> left on the signed quote</p><p class="muted">You have not paid anything. Nothing is charged if the seller does not answer.</p>`)}${tl([['You took the offer', 'off']])}`;
        countdown($('#bQ'), 599);
        later(() => { clear(); scr.innerHTML = `${page('Trade', `Buy ${fmtBch(st.amount)} BCH`)}${action(1, 'other', 'Waiting for the seller to lock the BCH', `<p class="r-dead"><b class="mono" id="bL"></b> left for the seller to lock the BCH</p><p class="muted">Don't pay yet. We'll tell you when the BCH is locked.</p>`)}${tl([['You took the offer', 'off'], ['The seller accepted', 'off']])}`; countdown($('#bL'), 1799); later(next, 1800); }, 1800);
      },
      () => bCheck([['You took the offer', 'off'], ['Seller locked the BCH', 'chain']]),
      bPay, bReceive,
    ],
    'buy-publish': [
      () => {
        st = { amount: st.amount ?? 0.5, margin: -1, methods: ['Bank transfer'], win: 60 };
        scr.innerHTML = `${page('Offers', 'Create an offer', '<span class="r-small">Buy BCH · Step 3 of 3</span>')}
          <div class="r-seg"><span class="on">Bitcoin Cash</span><span>PUSD</span></div>
          <div class="field"><span class="lbl">Your price: market <b id="pM"></b></span><input id="pR" type="range" min="-5" max="5" step="0.5" value="${st.margin}" aria-label="Price against the market"></div>
          <div class="field"><label for="pA">Most you want to buy (BCH)</label><input id="pA" type="number" min="0.001" max="5" step="0.1" value="${st.amount}"></div>
          <div class="field"><span class="lbl">How you can pay</span><div class="chips" id="pMeth">${METHODS.map((m) => `<button type="button" data-m="${m}" aria-pressed="${st.methods.includes(m)}">${m}</button>`).join('')}</div></div>
          <div class="r-card r-soft"><span class="r-small">No signature and no BCH needed: Campfire publishes your offer on-chain and pays the fee.</span></div>
          <button class="ab" type="button" id="pGo">Publish offer</button>`;
        const upd = () => { $('#pM').textContent = (st.margin >= 0 ? '+' : '') + st.margin + '%'; $('#pGo').disabled = !(st.amount > 0) || !st.methods.length; };
        $('#pR').oninput = (e) => { st.margin = +e.target.value; upd(); }; $('#pA').oninput = (e) => { st.amount = +e.target.value; upd(); };
        $$('#pMeth button').forEach((b) => b.onclick = () => { const m = b.dataset.m; /* not the label, which the Spanish page translates */ st.methods = st.methods.includes(m) ? st.methods.filter((x) => x !== m) : [...st.methods, m]; b.setAttribute('aria-pressed', String(st.methods.includes(m))); upd(); });
        $('#pGo').onclick = next; upd();
      },
      () => {
        st.fiat = price(st.margin) * st.amount; st.method = st.methods[0] || 'Bank transfer';
        scr.innerHTML = `${page('My offers', 'Your offer is live', tag('chain', 'Published on-chain'))}<div class="state-box wait"><b><span class="spin"></span>Waiting for sellers</b><span>Nothing is locked until a seller answers and you accept.</span></div>`;
        later(() => { scr.innerHTML = `${page('Trade', `Buy ${fmtBch(st.amount)} BCH`)}${action(0, 'you', `A seller wants to sell you ${fmtBch(st.amount)} BCH`, `<p class="muted">Accepting is free and needs no signature. You pay only after the coins are locked for you.</p><p class="r-dead"><b class="mono" id="aT"></b> left to accept at this price</p><p class="muted">You will pay <b class="mono">${fmtUsd(st.fiat)}</b> by ${st.method.toLowerCase()}, after the coins are locked for you.</p><button class="ab" type="button" id="aOk">Accept</button><button class="ab ghost" type="button" id="aNo" style="margin-top:0">Decline</button>`)}`; countdown($('#aT'), 599); $('#aOk').onclick = next; $('#aNo').onclick = () => setWay(way, false); }, 1600);
      },
      () => {
        scr.innerHTML = `${page('Trade', `Buy ${fmtBch(st.amount)} BCH`)}${action(1, 'other', 'Waiting for the seller to lock the BCH', `<p class="r-dead"><b class="mono" id="bL"></b> left for the seller to lock the BCH</p><p class="muted">Don't pay yet. We'll tell you when the BCH is locked.</p>`)}${tl([['A seller answered your offer', 'off'], ['You accepted', 'off']])}`;
        countdown($('#bL'), 1799);
        later(() => { clear(); bCheck([['A seller answered your offer', 'off'], ['Seller locked the BCH', 'chain']]); }, 1800);
      },
      bPay, bReceive,
    ],
    'sell-publish': [
      () => {
        st = { margin: st.margin ?? 2.5, amount: st.amount ?? 0.5, methods: st.methods ?? ['Bank transfer'], win: st.win ?? 60 };
        scr.innerHTML = `${page('Offers', 'Create an offer', '<span class="r-small">Sell BCH · Step 3 of 3</span>')}
          <div class="r-seg"><span class="on">Bitcoin Cash</span><span>PUSD</span></div>
          <div class="field"><span class="lbl">Your price: market <b id="sMargin"></b> · <span class="mono" id="sPrice"></span></span><input id="sRange" type="range" min="-5" max="10" step="0.5" value="${st.margin}" aria-label="Price against the market"></div>
          <div class="field"><label for="sAmt">Largest trade (BCH)</label><input id="sAmt" type="number" min="0.001" max="5" step="0.1" value="${st.amount}"></div>
          <div class="field"><span class="lbl">Ways buyers can pay you</span><div class="chips" id="sMethods">${METHODS.map((m) => `<button type="button" data-m="${m}" aria-pressed="${st.methods.includes(m)}">${m}</button>`).join('')}</div></div>
          <div class="field"><span class="lbl">Time to pay</span><div class="chips" id="sWin">${[60, 30, 15].map((m) => `<button type="button" aria-pressed="${st.win === m}">${m} minutes</button>`).join('')}</div></div>
          <button class="ab" type="button" id="sGo">Publish offer</button><span class="r-note">Signs in your wallet</span>`;
        const upd = () => { $('#sMargin').textContent = (st.margin >= 0 ? '+' : '') + st.margin + '%'; $('#sPrice').textContent = fmtUsd(price(st.margin)); $('#sGo').disabled = !(st.amount > 0) || !st.methods.length; };
        $('#sRange').oninput = (e) => { st.margin = +e.target.value; upd(); };
        $('#sAmt').oninput = (e) => { st.amount = +e.target.value; upd(); };
        $$('#sMethods button').forEach((b) => b.onclick = () => { const m = b.dataset.m; /* not the label, which the Spanish page translates */ st.methods = st.methods.includes(m) ? st.methods.filter((x) => x !== m) : [...st.methods, m]; b.setAttribute('aria-pressed', String(st.methods.includes(m))); upd(); });
        $$('#sWin button').forEach((b) => b.onclick = () => { st.win = parseInt(b.textContent); $$('#sWin button').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); });
        $('#sGo').onclick = () => wallet('publish your offer', next);
        upd();
      },
      () => {
        st.fiat = price(st.margin) * st.amount; st.method = st.methods[0] || 'Bank transfer';
        scr.innerHTML = `${page('My offers', 'Your offer is live', tag('chain', 'Published on-chain'))}<div class="state-box wait"><b><span class="spin"></span>Waiting for buyers</b><span>No coins are locked until a buyer takes your offer and you accept.</span></div>`;
        later(() => { scr.innerHTML = `${page('Trade', `Sell ${fmtBch(st.amount)} BCH`)}${action(0, 'you', 'Buyer took your offer', `<p class="muted">They will pay <b class="mono">${fmtUsd(st.fiat)}</b> by ${st.method.toLowerCase()}.</p><p class="r-dead"><b class="mono" id="aT"></b> left to accept, then 30 min to lock</p>${lockBox()}<button class="ab" type="button" id="sLock">Accept and lock ${fmtBch(st.amount)} BCH</button><span class="r-note">Signs in your wallet</span>`)}`; countdown($('#aT'), 599); $('#sLock').onclick = () => wallet(`lock ${fmtBch(st.amount)} BCH`, next); }, 1600);
      },
      sWaitPay, sRelease, sDone,
    ],
    'sell-take': [
      () => {
        st = { pick: st.pick ?? 0, amount: st.amount ?? 0.5, win: 60 };
        scr.innerHTML = `${page('Offers', 'Sell BCH')}<div class="r-tabs"><span>Buy</span><span class="on">Sell</span></div><div class="r-list">${offerRows(OFFERS.sell, 'Buyer')}</div>
          <div class="field"><label for="tAmt">How much BCH do you sell?</label><input id="tAmt" type="number" min="0.001" max="5" step="0.1" value="${st.amount}"></div>
          <div class="r-card r-soft"><div class="row"><span class="muted">You get</span><b class="mono" id="tGet"></b></div><span class="r-small">Taking is free and locks nothing. The buyer has 10 minutes to accept.</span></div>
          <button class="ab" type="button" id="tGo">Take this offer</button>`;
        const upd = () => { const o = OFFERS.sell[st.pick]; st.fiat = price(o.p) * st.amount; st.win = o.w; st.method = o.m; $('#tGet').textContent = fmtUsd(st.fiat); $('#tGo').disabled = !(st.amount > 0); };
        pickOffers(upd); $('#tAmt').oninput = (e) => { st.amount = +e.target.value; upd(); }; $('#tGo').onclick = next; upd();
      },
      () => {
        scr.innerHTML = `${page('Trade', `Sell ${fmtBch(st.amount)} BCH`)}${action(0, 'other', 'Waiting for the buyer to accept', `<p class="r-dead"><b class="mono" id="aT"></b> left to accept at this price</p><p class="muted">Nothing is locked yet.</p>`)}${tl([['You answered the buyer\'s offer', 'off']])}`;
        countdown($('#aT'), 599);
        later(() => { clear(); scr.innerHTML = `${page('Trade', `Sell ${fmtBch(st.amount)} BCH`)}${action(1, 'you', 'Buyer accepted. You lock the BCH', `<p class="r-dead"><b class="mono" id="lT"></b> locking window</p>${lockBox()}<button class="ab" type="button" id="sLock">Lock ${fmtBch(st.amount)} BCH</button><span class="r-note">Signs in your wallet</span>`)}`; countdown($('#lT'), 1799); $('#sLock').onclick = () => wallet(`lock ${fmtBch(st.amount)} BCH`, next); }, 1800);
      },
      sWaitPay, sRelease, sDone,
    ],
  };
  function done(title, msg, other, label) {
    scr.innerHTML = `${page('Trade', title, `<div style="display:flex;gap:6px;flex-wrap:wrap">${tag('chain', 'Real escrow on mainnet')}${tag('sim', 'Simulated fiat payment')}</div>`)}<div class="done-glow"><span class="emb green"><svg class="ic"><use href="#i-check"/></svg></span><div class="app-title">Trade completed</div><p class="muted">${msg}</p></div><button class="ab ghost" type="button" id="xOther">${label}</button><button class="ab ghost" type="button" id="xAgain" style="margin-top:0">Start again</button>`;
    $('#xOther').onclick = () => setWay(other, true);
    $('#xAgain').onclick = () => setWay(way, true);
  }
  const setWay = (w, jump) => {
    const changed = w !== way;
    way = w; st = {}; step = -1; trade.dataset.way = w;
    $$('.way', trade).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.way === w)));
    buildSteps(); go(0);
    if (changed && !reduce) { phoneCol.classList.remove('flip'); void phoneCol.offsetWidth; phoneCol.classList.add('flip'); }
    if (jump) $('.ways', trade).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  };
  $$('.way', trade).forEach((b) => b.onclick = () => setWay(b.dataset.way));
  $$('button', modeBox).forEach((b) => b.onclick = () => { if (b.dataset.mode === mode) return; mode = b.dataset.mode; st = {}; step = -1; buildSteps(); go(0); });
  way = ''; setWay('sell');

  /* ===== 6 FAQ: tabs + one answer open at a time ===== */
  const tabs = $$('#faqTabs button'), qs = $$('#faqList details');
  const showCat = (cat) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.cat === cat)));
    let first = true;
    qs.forEach((d) => { const on = d.dataset.cat === cat; d.hidden = !on; d.open = on && first; if (on) first = false; });
  };
  tabs.forEach((t) => t.onclick = () => showCat(t.dataset.cat));
  qs.forEach((d) => d.addEventListener('toggle', () => { if (d.open) qs.forEach((o) => { if (o !== d) o.open = false; }); }));
  showCat('start');

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    observers.forEach((o) => o.disconnect());
    pending.forEach((id) => window.clearTimeout(id));
  };
}

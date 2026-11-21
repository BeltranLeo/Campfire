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
    if (!reduce) { const wr = why.getBoundingClientRect(); why.style.setProperty('--o', Math.max(-1, Math.min(1, (innerHeight / 2 - wr.top - wr.height / 2) / innerHeight)).toFixed(3)); }
    if (!reduce && finePointer) hero.style.setProperty('--sy', Math.min(scrollY / innerHeight, 1).toFixed(3));
    if (desk.matches) { if (live(ecoMap.closest('section'))) syncEco(); if (live(stepsBox)) syncWalk(); }
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
  const P = { seller: [15, 50], buyer: [85, 50], arbiter: [50, 14], center: [50, 50] };
  const fly = (path, ms = 1500) => {
    if (reduce || !coin.animate) return;
    coin.animate(path.map(([x, y], i) => ({ left: x + '%', top: y + '%', opacity: i === 0 || i === path.length - 1 ? 0 : 1, offset: i / (path.length - 1) })), { duration: ms, easing: 'cubic-bezier(.65,0,.35,1)' });
  };
  const EXITS = { release: [P.center, P.center, P.buyer, P.buyer], refund: [P.center, P.center, P.seller, P.seller], arbitrate: [P.center, P.center, P.arbiter, P.arbiter], reclaim: [P.center, P.center, [40, 70], [24, 68], P.seller, P.seller] };
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
    if (n === 2 && prev < 2) fly([P.seller, P.seller, P.center, P.center], 1300);
    n === 5 ? startExits() : stopExits();
  };
  const syncEco = () => setEco(pick(ecoSteps, 'eco'));
  new Observer((es, o) => es.forEach((e) => { if (e.isIntersecting) { setEco(desk.matches ? Math.max(1, pick(ecoSteps, 'eco')) : 5); o.disconnect(); } }), { threshold: .25 }).observe(ecoMap);

  /* ===== 5 Want to try a trade? ===== */
  const scr = $('#simScreen'), stepsBox = $('#walkSteps'), sw = $('#simSwitch'), summary = $('#summary'), whatIfBtn = $('#whatIf');
  const MARKET = 420; // Example only: a fictional USD price per BCH.
  const fmtUsd = (n) => 'USD ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBch = (n) => (Math.round(n * 1e8) / 1e8).toString();
  const pad = (n) => String(n).padStart(2, '0');
  const METHODS = ['Bank transfer', 'Cash in person', 'Payment app'];
  let way = 'sell', step = -1, timers = [], st = {};
  const later = (fn, ms) => timers.push(setTimeout(fn, reduce ? Math.min(ms, 300) : ms));
  const clear = () => { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; };
  const countdown = (el, from) => { let s = from; const t = () => { el.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; s = Math.max(0, s - 1); }; t(); timers.push(setInterval(t, 1000)); };

  const FLOWS = {
    sell: {
      sum: [['You start with', 'Bitcoin Cash'], ['You get', 'Fiat money, in your account'], ['Your key moment', 'Release only with the money in your bank app']],
      steps: [
        ['act', 'Your turn', 'Set your price and publish.', 'Choose your margin over the market price, how much you sell, how buyers can pay you and how long they have to pay.', 'Nothing is locked yet: the offer is an announcement until someone takes it. Publishing costs less than a cent.'],
        ['time', 'Time is running', 'Accept a buyer.', 'A buyer takes your offer. You have 10 minutes to accept.', 'The price is held while the clock runs. If you don\'t accept, the request is dropped.'],
        ['wait', 'The contract holds them', 'Lock the coins in the contract.', 'Sign once in your wallet. You have about 60 minutes to lock.', 'A contract made only for this trade holds the coins. It can pay the buyer or return them to you.'],
        ['wait', 'Someone else is working', 'Wait for the payment.', 'Nothing. The buyer pays you outside Campfire, within the time you set.', 'If the buyer doesn\'t pay in time, the trade is cancelled and the coins come back to you.'],
        ['time', 'Check before you act', 'Check your bank app, then release.', 'Confirm the exact amount in your own bank app — not a screenshot. Then release.', 'Releasing pays the buyer from the contract. It can\'t be undone.'],
        ['chain', 'Confirmed on-chain', 'You got paid.', 'Nothing else to do.', 'The payout is a real transaction anyone can check on-chain.'],
      ],
    },
    buy: {
      sum: [['You start with', 'Fiat money — no BCH needed'], ['You get', 'Bitcoin Cash, in your wallet'], ['Your key moment', 'Pay only after “Safe at 0-conf”']],
      steps: [
        ['act', 'Your turn', 'Pick an offer and take it.', 'Compare price, payment method and time to pay. Type how much BCH you want.', 'You don\'t need any BCH. Your wallet only gives an address to receive.'],
        ['wait', 'Someone else is working', 'The seller locks the coins.', 'Wait. Don\'t pay anything yet.', 'The seller accepts and moves the BCH into this trade\'s contract.'],
        ['chain', 'Verified on the network', 'Your browser checks the deposit.', 'Watch the check finish.', 'Your browser rebuilds the contract and watches the network for 5 quiet seconds: Safe at 0-conf.'],
        ['time', 'Your turn, with a clock', 'Pay and mark as paid.', 'Send the money with the seller\'s method before the clock runs out, then tap Mark as paid.', 'The seller sets the time to pay. If it runs out, the trade is cancelled and the coins go back.'],
        ['wait', 'Someone else is working', 'The seller releases.', 'Wait while the seller checks their bank app.', 'When the seller signs, the contract pays the BCH to your wallet.'],
        ['chain', 'Confirmed on-chain', 'The BCH is yours.', 'Nothing else to do.', 'The payout is a real transaction anyone can check on-chain.'],
      ],
    },
  };
  const buildSteps = () => {
    const f = FLOWS[way];
    summary.innerHTML = f.sum.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    stepsBox.innerHTML = f.steps.map(([c, lbl, h, you, sys], i) => `<div class="wstep" data-w="${i}"><span class="n">${i + 1}</span><div><span class="pill ${c}">${lbl}</span><h3>${h}</h3><dl><div><dt>What you do</dt><dd>${you}</dd></div><div><dt>What happens</dt><dd>${sys}</dd></div></dl></div></div>`).join('');
  };
  const wSteps = () => $$('.wstep', stepsBox);
  const next = () => {
    const n = step + 1, el = wSteps()[n];
    if (desk.matches && el) { const y = el.getBoundingClientRect().top + scrollY - innerHeight * .4; scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' }); setTimeout(() => go(n), reduce ? 0 : 450); }
    else go(n);
  };
  const go = (n) => {
    if (n === step) return;
    step = n; clear();
    wSteps().forEach((s) => s.classList.toggle('on', +s.dataset.w === n));
    whatIfBtn.classList.toggle('show', n === 3);
    whatIfBtn.textContent = way === 'buy' ? 'What if I don\'t pay in time?' : 'What if the buyer doesn\'t pay?';
    (way === 'sell' ? SELL : BUY)[n]();
  };
  const syncWalk = () => { const els = wSteps(); if (els.length) go(pick(els, 'w')); };

  const head = (title, label) => `<div class="app-bar"><span>${label}</span><span>Step ${step + 1} of 6</span></div><div class="bar6">${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i < step ? 'd' : i === step ? 'c' : ''}"></i>`).join('')}</div><div class="app-title">${title}</div>`;
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
  const wallet = (what, onOk) => sheet('dark', `<span class="pill neutral" style="align-self:flex-start;background:rgba(138,150,179,.14);color:var(--mist)">Simulated wallet</span><span class="t">Sign to ${what}</span><span class="muted">In the real app, your Bitcoin Cash wallet opens here and asks you to approve. It only asks when coins move.</span><button class="ab" type="button">Approve</button><button class="ab ghost" type="button" style="color:var(--pearl);border-color:rgba(244,243,238,.35)">Back</button>`, onOk);
  whatIfBtn.onclick = () => sheet('light', `<span class="t">Time ran out</span><div class="state-box neutral"><b>Trade cancelled</b><span>The coins go back to the seller. Nobody loses anything.</span></div><div class="state-box arb"><b>Or: open a dispute</b><span>If something else went wrong, either side can open a dispute. An arbiter decides who gets the coins.</span></div><button class="ab ghost" type="button">← Back to the trade</button>`);

  const SELL = [
    () => {
      st = { margin: st.margin ?? 2, amount: st.amount ?? 0.5, methods: st.methods ?? ['Bank transfer'], win: st.win ?? 30 };
      scr.innerHTML = `${head('Sell BCH', 'Create an offer')}
        <div class="field"><span class="lbl">Price: <b id="sMargin"></b> over market</span><input id="sRange" type="range" min="-5" max="10" step="0.5" value="${st.margin}" aria-label="Margin over market price"><span class="muted" style="font-size:12px">Example: <span class="mono" id="sPrice"></span> per BCH</span></div>
        <div class="field"><label for="sAmt">Amount to sell (BCH)</label><input id="sAmt" type="number" min="0.001" max="5" step="0.1" value="${st.amount}"></div>
        <div class="field"><span class="lbl">How buyers can pay you</span><div class="chips" id="sMethods">${METHODS.map((m) => `<button type="button" data-m="${m}" aria-pressed="${st.methods.includes(m)}">${m}</button>`).join('')}</div></div>
        <div class="field"><span class="lbl">Time for buyers to pay (you choose)</span><div class="chips" id="sWin">${[15, 30, 60].map((m) => `<button type="button" aria-pressed="${st.win === m}">${m} min</button>`).join('')}</div></div>
        <button class="ab" type="button" id="sGo">Publish offer</button>`;
      const upd = () => { $('#sMargin').textContent = (st.margin > 0 ? '+' : '') + st.margin + '%'; $('#sPrice').textContent = fmtUsd(MARKET * (1 + st.margin / 100)); $('#sGo').disabled = !(st.amount > 0) || !st.methods.length; };
      $('#sRange').oninput = (e) => { st.margin = +e.target.value; upd(); };
      $('#sAmt').oninput = (e) => { st.amount = +e.target.value; upd(); };
      $$('#sMethods button').forEach((b) => b.onclick = () => { const m = b.dataset.m; /* not the label, which the Spanish page translates */ st.methods = st.methods.includes(m) ? st.methods.filter((x) => x !== m) : [...st.methods, m]; b.setAttribute('aria-pressed', String(st.methods.includes(m))); upd(); });
      $$('#sWin button').forEach((b) => b.onclick = () => { st.win = parseInt(b.textContent); $$('#sWin button').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); });
      $('#sGo').onclick = () => wallet('publish your offer', next);
      upd();
    },
    () => {
      scr.innerHTML = `${head('Your offer is live', 'Offer')}<div class="state-box wait" id="sWait"><b><span class="spin"></span>Waiting for buyers</b><span>No coins are locked until someone takes your offer.</span></div><div id="sReq"></div>`;
      later(() => {
        const fiat = MARKET * (1 + st.margin / 100) * st.amount;
        $('#sReq').outerHTML = `<div class="card"><b>A buyer wants ${fmtBch(st.amount)} BCH</b><span class="muted">They will pay <span class="mono">${fmtUsd(fiat)}</span> by ${(st.methods[0] || 'bank transfer').toLowerCase()}.</span></div><div class="state-box time"><b>Time left to accept</b><span class="timer" id="sT"></span></div><button class="ab" type="button" id="sAcc">Accept buyer</button>`;
        $('#sWait').remove(); countdown($('#sT'), 600); $('#sAcc').onclick = next;
      }, 1600);
    },
    () => {
      scr.innerHTML = `${head('Lock the coins', 'Trade')}<div class="card"><span class="muted" style="font-size:12px">You lock</span><span class="big-n">${fmtBch(st.amount)} <small style="font-size:14px">BCH</small></span></div><div class="state-box time"><b>Time left to lock</b><span class="timer" id="sLt"></span></div><div class="state-box wait"><b>Where do they go?</b><span>Into a contract made only for this trade. It can pay the buyer or return the coins to you.</span></div><button class="ab" type="button" id="sLock">Lock ${fmtBch(st.amount)} BCH</button>`;
      countdown($('#sLt'), 3599);
      $('#sLock').onclick = () => wallet(`lock ${fmtBch(st.amount)} BCH`, next);
    },
    () => {
      scr.innerHTML = `${head('Waiting for payment', 'Trade')}<div class="state-box wait"><b>✓ Locked in the contract</b><span>Only the buyer or you can receive the coins now.</span></div><div class="state-box wait" id="sP"><b><span class="spin"></span>Waiting for the buyer to pay</b><span>They have up to ${st.win} minutes.</span></div>`;
      later(() => { $('#sP').outerHTML = `<div class="state-box time"><b>The buyer marked it as paid</b><span>Check your account before you release.</span></div><button class="ab" type="button" id="sChk">Check the payment</button>`; $('#sChk').onclick = next; }, 2200);
    },
    () => {
      const fiat = MARKET * (1 + st.margin / 100) * st.amount;
      scr.innerHTML = `${head('Release the coins', 'Trade')}<div class="state-box time"><b>Only your bank app counts</b><span>Don't trust screenshots or messages. Once you release, the coins can't come back.</span></div>
        <label class="tick"><input type="checkbox" id="c1">I opened my bank app, not a screenshot</label>
        <label class="tick"><input type="checkbox" id="c2">I see exactly <b class="mono">&nbsp;${fmtUsd(fiat)}&nbsp;</b> from this buyer</label>
        <button class="ab" type="button" id="sRel" disabled>Release ${fmtBch(st.amount)} BCH to the buyer</button>`;
      const chk = () => { $('#sRel').disabled = !($('#c1').checked && $('#c2').checked); };
      $('#c1').onchange = chk; $('#c2').onchange = chk;
      $('#sRel').onclick = () => wallet('release the coins to the buyer', next);
    },
    () => done(`You sold ${fmtBch(st.amount)} BCH.`, 'buy', 'Now try buying'),
  ];
  const OFFERS = [{ n: 'amber-otter', m: 'Bank transfer', w: 30, p: 1.5 }, { n: 'quiet-heron', m: 'Payment app', w: 60, p: .5 }, { n: 'north-lantern', m: 'Cash in person', w: 15, p: 2.5 }];
  const BUY = [
    () => {
      st = { pick: st.pick ?? 0, amount: st.amount ?? 0.5 };
      scr.innerHTML = `${head('Buy BCH', 'Offers')}
        <div style="display:grid;gap:8px" id="bOffers">${OFFERS.map((o, i) => `<button type="button" class="offer" aria-pressed="${st.pick === i}"><span class="row"><b>${o.n}</b><span class="mono">${fmtUsd(MARKET * (1 + o.p / 100))}</span></span><span class="row muted" style="font-size:12px"><span>${o.m}</span><span>${o.w} min to pay</span></span></button>`).join('')}</div>
        <div class="field"><label for="bAmt">How much BCH do you want?</label><input id="bAmt" type="number" min="0.001" max="5" step="0.1" value="${st.amount}"></div>
        <div class="card" style="padding:10px 12px"><div class="row"><span class="muted">You pay</span><b class="mono" id="bPay"></b></div></div>
        <button class="ab" type="button" id="bGo">Take offer</button>`;
      const upd = () => { $('#bPay').textContent = fmtUsd(MARKET * (1 + OFFERS[st.pick].p / 100) * st.amount); $('#bGo').disabled = !(st.amount > 0); };
      $$('#bOffers .offer').forEach((b, i) => b.onclick = () => { st.pick = i; $$('#bOffers .offer').forEach((o, j) => o.setAttribute('aria-pressed', String(j === i))); upd(); });
      $('#bAmt').oninput = (e) => { st.amount = +e.target.value; upd(); };
      $('#bGo').onclick = next; upd();
    },
    () => {
      scr.innerHTML = `${head(fmtBch(st.amount) + ' BCH', 'Trade')}<div class="state-box wait" id="bW"><b><span class="spin"></span>Waiting for the seller to accept</b><span>Don't pay anything yet.</span></div>`;
      later(() => { $('#bW').innerHTML = '<b><span class="spin"></span>Waiting for the seller to lock the coins</b><span>Don\'t pay anything yet.</span>'; }, 1400);
      later(() => { $('#bW').outerHTML = `<div class="state-box wait"><b>✓ The seller locked the coins</b><span>They are in this trade's contract.</span></div><button class="ab" type="button" id="bNx">Check the deposit</button>`; $('#bNx').onclick = next; }, 2800);
    },
    () => {
      scr.innerHTML = `${head(fmtBch(st.amount) + ' BCH', 'Trade')}<div class="state-box wait"><b>Locked in the contract</b><span>The seller moved the coins into this trade's contract.</span></div><div class="state-box wait" id="bChk"><b><span class="spin"></span>Checking the deposit… <span class="mono" id="bS">5</span> s</b><span>Your browser is watching the network on its own.</span></div>`;
      let s = 5; const t = setInterval(() => { s -= 1; const el = $('#bS'); if (el) el.textContent = s; if (s <= 0) { clearInterval(t); $('#bChk').outerHTML = `<div class="state-box chain"><b>✓ Safe at 0-conf</b><span>The coins are really there. You can pay now.</span></div><button class="ab" type="button" id="bNext">Continue to payment</button>`; $('#bNext').onclick = next; } }, reduce ? 120 : 1000); timers.push(t);
    },
    () => {
      const o = OFFERS[st.pick];
      scr.innerHTML = `${head('Pay the seller', 'Trade')}<div class="state-box time"><b>Time left to pay (set by the seller)</b><span class="timer" id="bT"></span></div><div class="card"><span class="muted" style="font-size:12px">Send exactly</span><span class="big-n" style="font-size:22px">${fmtUsd(MARKET * (1 + o.p / 100) * st.amount)}</span><span class="muted" style="font-size:12px">${o.m} · details shared privately</span></div><label class="tick"><input type="checkbox" id="bPaid">I sent the payment from my own account</label><button class="ab" type="button" id="bMark" disabled>Mark as paid</button>`;
      countdown($('#bT'), o.w * 60 - 1);
      $('#bPaid').onchange = (e) => { $('#bMark').disabled = !e.target.checked; };
      $('#bMark').onclick = next;
    },
    () => {
      scr.innerHTML = `${head(fmtBch(st.amount) + ' BCH', 'Trade')}<div class="state-box wait" id="bR"><b><span class="spin"></span>Waiting for the seller to release</b><span>The seller is checking their bank app.</span></div>`;
      later(() => { $('#bR').outerHTML = `<div class="state-box wait"><b>✓ The seller released the coins</b><span>The contract is paying your wallet.</span></div><button class="ab" type="button" id="bFin">See the result</button>`; $('#bFin').onclick = next; }, 2400);
    },
    () => done(`${fmtBch(st.amount)} BCH is in your wallet.`, 'sell', 'Now try selling'),
  ];
  function done(msg, other, label) {
    scr.innerHTML = `${head('Done', 'Trade')}<div class="done-glow"><span class="emb green"><svg class="ic"><use href="#i-check"/></svg></span><div class="app-title">Trade completed</div><p class="muted">${msg}</p></div><div class="state-box chain"><b>On-chain</b><span>In the real app, this links to the payout in a block explorer.</span></div><button class="ab ghost" type="button" id="xOther">${label} ${icon(other === 'buy' ? 'in' : 'out')}</button><button class="ab ghost" type="button" id="xAgain" style="margin-top:0">Start again</button>`;
    $('#xOther').onclick = () => setWay(other, true);
    $('#xAgain').onclick = () => setWay(way, true);
  }
  const setWay = (w, jump) => {
    way = w; st = {}; step = -1; sw.dataset.way = w;
    $$('button', sw).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.way === w)));
    buildSteps(); go(0);
    if (jump) $('#how').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };
  $$('button', sw).forEach((b) => b.onclick = () => setWay(b.dataset.way));
  setWay('sell');

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

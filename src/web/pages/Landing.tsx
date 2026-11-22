import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { apiGet, type Offer } from '../api';
import { WalletButton } from '../components/Wallet';
import { usePoll } from '../hooks/usePoll';
import { setLang, useLang } from '../lang';
import markupEn from '../landing/landing.html?raw';
import { startLanding } from '../landing/motion.js';
import { translateToSpanish } from '../landing/translate';
import '../landing/landing.css';
import bandI2n from '../landing/img/band-i2n.webp';
import bandN2i from '../landing/img/band-n2i.webp';
import bannerGlass from '../landing/img/banner-glass.webp';
import book from '../landing/img/book.png';
import coinBch from '../landing/img/coin-bch.png';
import ben1 from '../landing/img/ben1.webp';
import ben2 from '../landing/img/ben2.webp';
import ben3 from '../landing/img/ben3.webp';
import ben4 from '../landing/img/ben4.webp';
import logoDark from '../landing/img/logo-dark.webp';
import panelBlue from '../landing/img/panel-blue.webp';
import panelLight from '../landing/img/panel-light.webp';
import simRibbon from '../landing/img/sim-ribbon.webp';
import symbol from '../landing/img/symbol.webp';
import texture from '../landing/img/texture.webp';
import wall from '../landing/img/wall.png';

// The front page for a visitor, exactly as Aye designed it (design/landing.src.html on the design branch): the
// markup and styles are hers, kept in src/web/landing/, and only the buttons are wired to the app's pages.
// The page brings its own header and footer, so the Shell draws only the hackathon banner above it; the app's
// wallet button goes into her header, at the top right, as the hackathon rules ask.

const IMAGES: Record<string, string> = {
  BAND_I2N: bandI2n,
  BAND_N2I: bandN2i,
  BANNER_GLASS: bannerGlass,
  BEN1: ben1,
  BEN2: ben2,
  BEN3: ben3,
  BEN4: ben4,
  BOOK: book,
  COIN_BCH: coinBch,
  LOGO_DARK: logoDark,
  PANEL_BLUE: panelBlue,
  PANEL_LIGHT: panelLight,
  SIM_RIBBON: simRibbon,
  SYMBOL: symbol,
  TEXTURE: texture,
  WALL: wall,
};

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [walletSlot, setWalletSlot] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const lang = useLang();
  const offers = usePoll(
    () => apiGet<{ offers: Offer[] }>('/api/offers?onlyOpen=true').then((r) => r.offers),
    'offers',
  );
  const demoOffer =
    offers.data?.find((o) => o.isDemo && o.document.asset === 'BCH') ?? offers.data?.find((o) => o.isDemo);
  const demoPath = demoOffer ? `/offers/${demoOffer.offerTxid}` : '/offers';

  const html = useMemo(() => markupEn.replace(/\{\{(\w+)\}\}/g, (_, key: string) => IMAGES[key] ?? ''), []);

  // The page scrolls smoothly to its sections and leaves room for its header, only while it is shown.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const style = document.documentElement.style;
    style.scrollBehavior = 'smooth';
    style.scrollPaddingTop = 'calc(var(--lp-header, 76px) + 8px)';
    const stop = startLanding(el);
    // In Spanish the texts are translated as they are drawn (landing/translate.ts).
    const stopTranslating = lang === 'es' ? translateToSpanish(el) : undefined;
    setWalletSlot(el.querySelector<HTMLElement>('#navWallet'));
    el.querySelector(`a[data-lang="${lang}"]`)?.setAttribute('aria-current', 'true');
    return () => {
      stop();
      stopTranslating?.();
      style.scrollBehavior = '';
      style.scrollPaddingTop = '';
    };
  }, [html, lang]);

  // Buttons marked data-to open the app's pages without reloading it ("demo" is the demo offer), section links
  // scroll, and the footer's language links switch the language. `lang` is here because the page is redrawn
  // (a new element) when the language changes.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      const langLink = (event.target as Element).closest<HTMLAnchorElement>('a[data-lang]');
      if (langLink) {
        event.preventDefault();
        setLang(langLink.dataset.lang === 'es' ? 'es' : 'en');
        return;
      }
      // The app routes by the address's hash, so a section link (#why) would open a page called "why": scroll to
      // the section instead.
      const sectionLink = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]:not([href^="#/"])');
      if (sectionLink && !sectionLink.dataset.to) {
        event.preventDefault();
        el.querySelector(sectionLink.getAttribute('href')!)?.scrollIntoView();
        return;
      }
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-to]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      const to = link.dataset.to === 'demo' ? demoPath : link.dataset.to!;
      window.scrollTo(0, 0);
      navigate(to);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [demoPath, navigate, lang]);

  return (
    <>
      <div key={lang} className="lp" ref={root} dangerouslySetInnerHTML={{ __html: html }} />
      {walletSlot && createPortal(<WalletButton />, walletSlot)}
    </>
  );
}

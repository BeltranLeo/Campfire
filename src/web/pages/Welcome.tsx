import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { WALLETS } from '../links';
import { NO_PREFS, loadPrefs, savePrefs, type Intent } from '../prefs';
import { useWallet } from '../wallet';
import { afterQuestions, buildPrefs, initialFiat, offersPath, type FiatCode } from '../welcome';

// Onboarding: the questions come first and need no wallet; a newcomer then gets a wallet and connects it. The
// answers stay in this browser and only sort what the person sees. The menu's "Preferences" opens step 1 alone.

const INTENTS: { value: Intent; title: string; hint: string }[] = [
  { value: 'buy', title: 'Buy BCH', hint: 'Pay with pesos or dollars' },
  { value: 'sell', title: 'Sell BCH', hint: 'Get pesos or dollars' },
  { value: 'both', title: 'Just looking', hint: 'See how it works first' },
];
const FIATS: { value: FiatCode; title: string }[] = [
  { value: 'ARS', title: 'Argentine pesos' },
  { value: 'USD', title: 'US dollars' },
];

export function Welcome() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const saved = loadPrefs();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [intent, setIntent] = useState<Intent>(saved?.intent ?? 'buy');
  const [fiat, setFiat] = useState<FiatCode>(initialFiat(saved));

  const connected = wallet.status === 'connected';
  const busy = wallet.status === 'pairing' || wallet.status === 'connecting';
  // A connected wallet only changes its preferences; the wallet steps are for people who have none yet.
  const preferencesOnly = connected && step !== 3;

  // Pairing finished on step 3: carry on to the offers the person asked for.
  useEffect(() => {
    if (connected && step === 3) navigate(offersPath(intent));
  }, [connected, step, intent, navigate]);

  // Skipping still counts as answering, so the questions are not asked again.
  const skip = () => {
    savePrefs(saved ?? NO_PREFS);
    navigate('/');
  };
  const answer = () => {
    savePrefs(buildPrefs(intent, fiat, saved));
    if (connected) return navigate(offersPath(intent));
    if (afterQuestions(intent) === 'looking') return navigate('/offers');
    setStep(2);
  };
  // Saved before pairing: it may reload the page, and nothing should be lost (the answers are local only).
  const toConnect = () => {
    savePrefs(buildPrefs(intent, fiat, saved));
    setStep(3);
  };

  const shown = preferencesOnly ? 1 : step;
  const total = preferencesOnly ? 1 : 3;

  return (
    <main className="s-main">
      <div className="s-onboard">
        <div className="cf-stack" data-gap="2">
          <div className="cf-row" data-between>
            <span className="cf-stepper">{preferencesOnly ? 'Preferences' : `Step ${shown} of 3`}</span>
            {shown === 1 ? (
              <Button variant="ghost" size="sm" onClick={skip}>
                Skip
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setStep((shown - 1) as 1 | 2)}>
                Back
              </Button>
            )}
          </div>
          {!preferencesOnly && (
            <div className="cf-progress">
              {[1, 2, 3].map((n) => (
                <i key={n} data-state={n <= shown ? 'done' : 'todo'} />
              ))}
            </div>
          )}
        </div>

        {shown === 1 && (
          <>
            <h1 className="cf-title">What would you like to do?</h1>
            <div className="cf-stack" data-gap="3">
              {INTENTS.map((option) => (
                <button key={option.value} type="button" className="cf-choice" aria-pressed={intent === option.value} onClick={() => setIntent(option.value)}>
                  <span>
                    {option.title}
                    <small>{option.hint}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="cf-stack" data-gap="2">
              <h2 className="cf-heading">Which money do you use?</h2>
              <div className="cf-seg wl-seg" role="group" aria-label="Which money do you use?">
                {FIATS.map((option) => (
                  <button key={option.value} type="button" aria-pressed={fiat === option.value} onClick={() => setFiat(option.value)}>
                    {option.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="s-actions">
              <div className="s-primary">
                <Button variant="primary" onClick={answer}>
                  {preferencesOnly ? 'Save' : 'Continue'}
                </Button>
                {!preferencesOnly && <span className="cf-small cf-subtle">No wallet needed yet.</span>}
              </div>
            </div>
          </>
        )}

        {shown === 2 && (
          <>
            <h1 className="cf-title">Your BCH goes to your own wallet</h1>
            <p className="cf-muted">A wallet is a free app on your phone. Only you control it: Campfire never holds your money.</p>
            <button type="button" className="cf-choice" onClick={toConnect}>
              <span>
                I already have a wallet
                <small>Selene or Paytaca</small>
              </span>
            </button>
            <section className="cf-card wl-card">
              <h2 className="cf-heading">Get a free wallet</h2>
              <ul className="wl-list">
                {WALLETS.map((w) => (
                  <li key={w.name} className="wl-item">
                    <span className="wl-text">
                      <strong>{w.name}</strong>
                      <small className="cf-small cf-subtle">{w.note}</small>
                    </span>
                    <a className="cf-btn" data-size="sm" href={w.url} target="_blank" rel="noreferrer">
                      Get it
                    </a>
                  </li>
                ))}
              </ul>
              <p className="cf-small cf-subtle">Install it, create a wallet, write down the recovery words, and come back here.</p>
            </section>
            <div className="s-actions">
              <button type="button" className="cf-btn" onClick={toConnect}>
                I have it now
              </button>
            </div>
          </>
        )}

        {shown === 3 && (
          <>
            <h1 className="cf-title">Connect your wallet</h1>
            <div className="s-actions">
              <div className="s-primary">
                <Button variant="primary" busy={busy} onClick={wallet.connect}>
                  Connect my wallet
                </Button>
                <span className="cf-signs">Connecting needs no signature</span>
              </div>
            </div>
          </>
        )}

        <p className="cf-small cf-subtle">Your answers stay on this device and only sort the offers you see. Change them anytime in the menu.</p>
      </div>
    </main>
  );
}

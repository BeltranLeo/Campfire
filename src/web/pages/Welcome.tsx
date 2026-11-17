import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { EmptyState } from '../components/States';
import { NO_PREFS, loadPrefs, savePrefs, type Intent } from '../prefs';
import { useWallet } from '../wallet';

// Onboarding (Onboarding-1 and -2): two questions, the first time a wallet connects. The answers stay in this
// browser and only sort what the person sees. The menu's "Preferences" opens the same page to change them.

const INTENTS: { value: Intent; title: string; hint: string }[] = [
  { value: 'buy', title: 'Buy BCH', hint: 'Pay with pesos or dollars. You don’t need any BCH.' },
  { value: 'sell', title: 'Sell BCH', hint: 'Get pesos or dollars for coins you already have.' },
  { value: 'both', title: 'Both, or just looking', hint: 'Show me everything.' },
];
const FIATS = [
  { value: 'ARS', title: 'Argentine pesos' },
  { value: 'USD', title: 'US dollars' },
];
const COINS = [
  { value: 'BCH', title: 'Bitcoin Cash', hint: 'BCH. Its price moves.' },
  { value: 'PUSD', title: 'PUSD', hint: 'A dollar token on Bitcoin Cash. 1 PUSD stays close to 1 USD.' },
];

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export function Welcome() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const saved = loadPrefs();
  const [step, setStep] = useState<1 | 2>(1);
  const [intent, setIntent] = useState<Intent>(saved?.intent ?? 'buy');
  const [fiat, setFiat] = useState<string[]>(saved?.fiat ?? ['ARS']);
  const [assets, setAssets] = useState<string[]>(saved?.assets ?? ['BCH']);

  if (wallet.status !== 'connected') {
    return (
      <main className="s-main">
        <section className="cf-card">
          <EmptyState
            title="Connect your wallet"
            action={
              <Button variant="primary" busy={wallet.status === 'pairing' || wallet.status === 'connecting'} onClick={wallet.connect}>
                Connect wallet
              </Button>
            }
          >
            Your preferences are kept for the wallet you connect. Connecting needs no signature.
          </EmptyState>
        </section>
      </main>
    );
  }

  // Skipping still counts as answering, so the questions are not asked again.
  const skip = () => {
    savePrefs(saved ?? NO_PREFS);
    navigate('/');
  };
  const finish = () => {
    savePrefs({ intent, fiat, assets });
    navigate(`/offers?side=${intent === 'sell' ? 'sell' : 'buy'}`);
  };

  return (
    <main className="s-main">
      <div className="s-onboard">
        <div className="cf-stack" data-gap="2">
          <span className="cf-stepper">Step {step} of 2</span>
          <div className="cf-progress">
            <i data-state="done" />
            <i data-state={step === 2 ? 'done' : 'todo'} />
          </div>
        </div>

        {step === 1 ? (
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
          </>
        ) : (
          <>
            <h1 className="cf-title">Which money do you use?</h1>
            <div className="cf-stack" data-gap="3">
              {FIATS.map((option) => (
                <button key={option.value} type="button" className="cf-choice" aria-pressed={fiat.includes(option.value)} onClick={() => setFiat(toggle(fiat, option.value))}>
                  <span>
                    {option.title}
                    <small>{option.value}</small>
                  </span>
                </button>
              ))}
            </div>
            <h2 className="cf-heading">Which coins interest you?</h2>
            <div className="cf-stack" data-gap="3">
              {COINS.map((option) => (
                <button key={option.value} type="button" className="cf-choice" aria-pressed={assets.includes(option.value)} onClick={() => setAssets(toggle(assets, option.value))}>
                  <span>
                    {option.title}
                    <small>{option.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="s-actions">
          <div className="s-primary">
            <Button variant="primary" onClick={step === 1 ? () => setStep(2) : finish}>
              {step === 1 ? 'Continue' : 'Show my offers'}
            </Button>
          </div>
          <Button variant="ghost" onClick={skip}>
            Skip
          </Button>
        </div>
        <p className="cf-small cf-subtle">Your answers stay on this device and only sort the offers you see. Change them anytime in the menu.</p>
      </div>
    </main>
  );
}

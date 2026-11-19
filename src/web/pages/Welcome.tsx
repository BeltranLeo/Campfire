import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { WALLETS } from '../links';
import { useWallet } from '../wallet';

// Getting a wallet: where to get one, then connecting it. Nothing is asked first, so the person goes straight to
// the platform and finds the offers on their own. Someone already connected has nothing to do here.

export function Welcome() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);

  const connected = wallet.status === 'connected';
  const busy = wallet.status === 'pairing' || wallet.status === 'connecting';

  useEffect(() => {
    if (connected) navigate('/');
  }, [connected, navigate]);

  return (
    <main className="s-main">
      <div className="s-onboard">
        <div className="cf-stack" data-gap="2">
          <div className="cf-row" data-between>
            <span className="cf-stepper">{`Step ${step} of 2`}</span>
            {step === 2 && (
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                Back
              </Button>
            )}
          </div>
          <div className="cf-progress">
            {[1, 2].map((n) => (
              <i key={n} data-state={n <= step ? 'done' : 'todo'} />
            ))}
          </div>
        </div>

        {step === 1 && (
          <>
            <h1 className="cf-title">Your BCH goes to your own wallet</h1>
            <p className="cf-muted">A wallet is a free app on your phone. Only you control it: Campfire never holds your money.</p>
            <button type="button" className="cf-choice" onClick={() => setStep(2)}>
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
              <button type="button" className="cf-btn" onClick={() => setStep(2)}>
                I have it now
              </button>
            </div>
          </>
        )}

        {step === 2 && (
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
      </div>
    </main>
  );
}

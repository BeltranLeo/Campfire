import { useState } from 'react';
import { setArbiterToken } from '../arbiterToken';
import { useMessages } from '../lang';
import { Button } from './Button';

// Invented copy: the design has no screen for the real arbiter.
/** Asks for the admin token and keeps it in memory only (see arbiterToken.ts). */
export function ArbiterTokenForm() {
  const [value, setValue] = useState('');
  const t = useMessages().arbiter;
  return (
    <form
      className="cf-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) setArbiterToken(value);
      }}
    >
      <div className="cf-field">
        <label htmlFor="arbiter-token">{t.adminToken}</label>
        <input
          id="arbiter-token"
          className="cf-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <span className="cf-hint">{t.tokenHint}</span>
      </div>
      <div className="s-actions">
        <Button variant="primary" type="submit" disabled={!value.trim()}>
          {t.useToken}
        </Button>
      </div>
    </form>
  );
}

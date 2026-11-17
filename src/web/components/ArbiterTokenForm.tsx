import { useState } from 'react';
import { setArbiterToken } from '../arbiterToken';
import { Button } from './Button';

// Invented copy: the design has no screen for the real arbiter.
/** Asks for the admin token and keeps it in memory only (see arbiterToken.ts). */
export function ArbiterTokenForm() {
  const [value, setValue] = useState('');
  return (
    <form
      className="cf-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) setArbiterToken(value);
      }}
    >
      <div className="cf-field">
        <label htmlFor="arbiter-token">Admin token</label>
        <input
          id="arbiter-token"
          className="cf-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <span className="cf-hint">Kept in this tab's memory only. It is gone when you reload or close the page.</span>
      </div>
      <div className="s-actions">
        <Button variant="primary" type="submit" disabled={!value.trim()}>
          Use token
        </Button>
      </div>
    </form>
  );
}

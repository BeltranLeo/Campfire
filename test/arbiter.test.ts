import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPost } from '../src/web/api.js';
import { getArbiterToken, setArbiterToken } from '../src/web/arbiterToken.js';

function stubFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setArbiterToken(null);
});

describe('the arbiter token (web)', () => {
  it('goes in the Authorization header and never in the URL', async () => {
    const calls = stubFetch();
    await apiGet('/api/trades/abc/chat?arbiter=true', 'secret-token');
    await apiPost('/api/trades/abc/verdict', { verdict: '01' }, 'secret-token');
    for (const call of calls) {
      expect(call.url).not.toContain('secret-token');
      expect((call.init.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
    }
    expect((calls[1].init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(calls[1].init.body).not.toContain('secret-token');
  });

  it('is not sent when there is none, so ordinary requests stay as they were', async () => {
    const calls = stubFetch();
    await apiGet('/api/trades');
    await apiPost('/api/trades/abc/paid', { buyerIdentity: 'x' });
    expect(calls[0].init.headers).toBeUndefined();
    expect(Object.keys(calls[1].init.headers as object)).toEqual(['content-type']);
  });

  it('lives in memory only and can be forgotten', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => storage.set(k, v), getItem: (k: string) => storage.get(k) ?? null });
    setArbiterToken('  abc  ');
    expect(getArbiterToken()).toBe('abc');
    expect(storage.size).toBe(0);
    setArbiterToken('   ');
    expect(getArbiterToken()).toBeNull();
    setArbiterToken('abc');
    setArbiterToken(null);
    expect(getArbiterToken()).toBeNull();
  });
});

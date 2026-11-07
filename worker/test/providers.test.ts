import { describe, expect, it } from 'vitest';
import { adsbLolProvider } from '../src/providers/readsb';
import { OpenSkyProvider, parseOpenSkyState } from '../src/providers/opensky';
import { CommercialProviderStub } from '../src/providers/commercialStub';
import { createProviders } from '../src/providers';
import { ProviderError } from '../src/providers/types';
import DEL from '../../fixtures/adsb-v2/DEL.json';

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    return handler(url, init);
  };
  return { fn, calls };
}

describe('ReadsbV2Provider (adsb.lol)', () => {
  it('builds point URLs and parses the response', async () => {
    const f = fakeFetch(() => Response.json(DEL));
    const p = adsbLolProvider(f.fn);
    const list = await p.fetch({ kind: 'point', lat: 28.5665, lon: 77.1031, radiusNm: 60 });
    expect(f.calls[0]).toBe('https://api.adsb.lol/v2/point/28.5665/77.1031/60');
    expect(list.length).toBe((DEL as { ac: unknown[] }).ac.length);
    expect(list[0].source).toBe('adsblol');
  });

  it('maps callsign / hex / reg queries', async () => {
    const f = fakeFetch(() => Response.json({ now: Date.now(), ac: [] }));
    const p = adsbLolProvider(f.fn);
    await p.fetch({ kind: 'callsign', callsign: 'igo2132' });
    await p.fetch({ kind: 'hex', hex: '801822' });
    await p.fetch({ kind: 'reg', reg: 'vt-nhc' });
    expect(f.calls).toEqual([
      'https://api.adsb.lol/v2/callsign/IGO2132',
      'https://api.adsb.lol/v2/hex/801822',
      'https://api.adsb.lol/v2/reg/VT-NHC',
    ]);
    expect(p.supports('bbox')).toBe(false);
  });

  it('surfaces 429 with Retry-After', async () => {
    const f = fakeFetch(() => new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } }));
    const err = await adsbLolProvider(f.fn)
      .fetch({ kind: 'hex', hex: 'abcdef' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(7000);
  });
});

describe('OpenSkyProvider', () => {
  it('gets an OAuth2 client-credentials token once and reuses it', async () => {
    let tokenCalls = 0;
    const f = fakeFetch((url, init) => {
      if (url.includes('openid-connect/token')) {
        tokenCalls++;
        expect(String(init?.body)).toContain('grant_type=client_credentials');
        return Response.json({ access_token: 'tok', expires_in: 1800 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      return Response.json({
        time: 1700000000,
        states: [['801822', 'IGO2132 ', 'India', 1700000000, 1700000001, 76.8, 27.7, 7900, false, 219.4, 182.8, 8.1, null, 8230, '0561', false, 0, 4]],
      });
    });
    const p = new OpenSkyProvider('id', 'secret', f.fn);
    const a = await p.fetch({ kind: 'bbox', bbox: { minLat: 27, maxLat: 29, minLon: 76, maxLon: 78 } });
    await p.fetch({ kind: 'hex', hex: '801822' });
    expect(tokenCalls).toBe(1);
    expect(a[0]).toMatchObject({ hex: '801822', callsign: 'IGO2132', category: 'A3', source: 'opensky' });
    expect(a[0].altBaro).toBe(25919);
    expect(a[0].gs).toBeCloseTo(426.5, 0);
    expect(a[0].vrate).toBe(1594);
  });

  it('charges credits by area', () => {
    const p = new OpenSkyProvider('id', 's', fetch);
    expect(p.cost({ kind: 'bbox', bbox: { minLat: 0, maxLat: 4, minLon: 0, maxLon: 4 } })).toBe(1);
    expect(p.cost({ kind: 'bbox', bbox: { minLat: 0, maxLat: 10, minLon: 0, maxLon: 10 } })).toBe(2);
    expect(p.cost({ kind: 'bbox', bbox: { minLat: 0, maxLat: 30, minLon: 0, maxLon: 30 } })).toBe(4);
  });

  it('ignores states without position', () => {
    expect(parseOpenSkyState(['a', null, 'x', null, 1, null, null, null, false, null, null, null, null, null, null, false, 0])).toBeUndefined();
  });
});

describe('provider config', () => {
  it('defaults to community feeds and skips OpenSky without credentials', () => {
    const { active, skipped } = createProviders({} as never);
    expect(active.map((p) => p.id)).toEqual(['adsblol', 'airplaneslive']);
    expect(skipped[0]).toContain('opensky');
  });

  it('switching to a licensed feed is a config change', async () => {
    const { active } = createProviders({ PROVIDERS: 'commercial' } as never);
    expect(active.map((p) => p.id)).toEqual(['commercial']);
    expect(active[0].commercialUseAllowed).toBe(true);
    await expect(new CommercialProviderStub(undefined, undefined).fetch({ kind: 'hex', hex: 'a' })).rejects.toThrow(/not configured/);
  });
});

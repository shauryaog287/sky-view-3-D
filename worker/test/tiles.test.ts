import { describe, expect, it } from 'vitest';
import { checkTilesSession } from '../src/tiles';
import { MemoryCounterStore } from '../src/lib/counters';

const cfg = { perSubjectPerDay: 3, perIpPerDay: 5, globalPerDay: 8 };

describe('Google tiles session caps', () => {
  it('allows sessions until the per-user cap, then denies', async () => {
    const s = new MemoryCounterStore();
    for (let i = 0; i < 3; i++) expect((await checkTilesSession(s, cfg, { subject: 'device:a' }, '2026-11-07')).allowed).toBe(true);
    const r = await checkTilesSession(s, cfg, { subject: 'device:a' }, '2026-11-07');
    expect(r).toMatchObject({ allowed: false, reason: 'subject_cap', usedToday: 3, limitToday: 3 });
    // A new day resets.
    expect((await checkTilesSession(s, cfg, { subject: 'device:a' }, '2026-11-08')).allowed).toBe(true);
  });

  it('caps one IP minting many device ids', async () => {
    const s = new MemoryCounterStore();
    const results = [];
    for (let i = 0; i < 7; i++) results.push((await checkTilesSession(s, cfg, { subject: `device:${i}`, ipHash: 'ip1' }, 'd')).allowed);
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });

  it('enforces a global daily budget', async () => {
    const s = new MemoryCounterStore();
    let allowed = 0;
    for (let i = 0; i < 12; i++) if ((await checkTilesSession(s, cfg, { subject: `user:${i}` }, 'd')).allowed) allowed++;
    expect(allowed).toBe(8);
    const r = await checkTilesSession(s, cfg, { subject: 'user:new' }, 'd');
    expect(r.reason).toBe('global_cap');
  });
});

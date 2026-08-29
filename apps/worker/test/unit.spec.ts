import { describe, it, expect } from 'vitest';
import { stringifyBigInts } from '../src/json';
import { QUEUE_TX_MONITOR, QUEUE_WEBHOOK_DISPATCH } from '../src/queues';

describe('worker utilities', () => {
  it('stringifies bigints and toJSON values', () => {
    const out = stringifyBigInts({ a: 10n, b: [{ c: 2n }], d: new Date('2026-01-01T00:00:00Z') }) as Record<string, unknown>;
    expect(out.a).toBe('10');
    expect((out.b as unknown[])[0]).toEqual({ c: '2' });
    expect(out.d).toBe('2026-01-01T00:00:00.000Z');
  });

  it('defines the BullMQ queue names', () => {
    expect(QUEUE_TX_MONITOR).toBe('tx-monitor');
    expect(QUEUE_WEBHOOK_DISPATCH).toBe('webhook-dispatch');
  });
});
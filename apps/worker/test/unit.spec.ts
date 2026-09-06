import { describe, it, expect, vi } from 'vitest';
import { stringifyBigInts } from '../src/json';
import { QUEUE_TX_MONITOR, QUEUE_WEBHOOK_DISPATCH, QUEUE_SETTLEMENT } from '../src/queues';
import { processQuoteExpiry } from '../src/expiry';

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
    expect(QUEUE_SETTLEMENT).toBe('settlement');
  });
});

describe('quote expiry (PRD test case: quote expires before execution)', () => {
  it('marks an ACTIVE quote EXPIRED once its TTL has passed', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'qt_1' });
    const prisma = {
      quote: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'qt_1',
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() - 1000),
        }),
        update,
      },
    } as never;
    const job = { data: { quoteId: 'qt_1' } } as never;
    const ctx = { prisma } as never;
    await processQuoteExpiry(job, ctx);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'qt_1' },
      data: { status: 'EXPIRED' },
    });
  });

  it('leaves a quote that has not expired untouched', async () => {
    const update = vi.fn();
    const prisma = {
      quote: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'qt_2',
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }),
        update,
      },
    } as never;
    const job = { data: { quoteId: 'qt_2' } } as never;
    const ctx = { prisma } as never;
    await processQuoteExpiry(job, ctx);
    expect(update).not.toHaveBeenCalled();
  });
});
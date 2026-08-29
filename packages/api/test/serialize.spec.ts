import { describe, it, expect } from 'vitest';
import { stringifyBigInts } from '../src/common/serialize';
import { PayMeshError } from '../src/common/errors';

describe('stringifyBigInts', () => {
  it('converts bigints to strings recursively', () => {
    const input = {
      amount: 12345678901234567890n,
      route: [{ amountIn: 1n, ok: true }],
      value: null,
    };
    const output = stringifyBigInts(input) as Record<string, unknown>;
    expect(output.amount).toBe('12345678901234567890');
    expect((output.route as unknown[])[0]).toEqual({ amountIn: '1', ok: true });
    expect(output.value).toBeNull();
  });
});

describe('PayMeshError', () => {
  it('carries a typed code and user-facing message', () => {
    const err = new PayMeshError('ROUTE_NOT_FOUND', 'no route', 'No route available.', 404);
    expect(err.code).toBe('ROUTE_NOT_FOUND');
    expect(err.userMessage).toBe('No route available.');
    expect(err.status).toBe(404);
  });
});
/** Deep-converts bigints (and toJSON-able values like Decimal/Date) to strings. */
export function stringifyBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object') {
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
      return (value as { toJSON: () => unknown }).toJSON();
    }
    if (Array.isArray(value)) return value.map((v) => stringifyBigInts(v));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stringifyBigInts(v);
    return out;
  }
  return value;
}
import { randomUUID } from 'node:crypto';

export { PrismaClient, Prisma } from '@prisma/client';

export { hashApiKey } from './api-key';

/** Generates a human-prefixed id, e.g. `dep_...` / `qt_...` / `tx_...`. */
export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

/** Prisma returns BigInt for BigInt fields; converts them for JSON. */
export function bigIntToJson(value: bigint | null | undefined): string | null {
  return value == null ? null : value.toString();
}
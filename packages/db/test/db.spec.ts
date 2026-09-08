import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

const DB_PACKAGE_ROOT = path.resolve(__dirname, '..');

describe('db', () => {
  it('applies migrations on a fresh Postgres and supports create/read', async () => {
    let container: PostgreSqlContainer | undefined;
    try {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
    } catch (error) {
      console.warn(
        'Docker unavailable — skipping DB integration test. Start Docker to run it.',
        (error as Error).message,
      );
      return;
    }

    try {
      const url = container.getConnectionUri();
      execFileSync('pnpm', ['prisma', 'migrate', 'deploy'], {
        cwd: DB_PACKAGE_ROOT,
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });

      const prisma = new PrismaClient({ datasources: { db: { url } } });
      const org = await prisma.organization.create({ data: { name: 'test-org' } });
      const project = await prisma.project.create({ data: { organizationId: org.id, name: 'test-project', environment: 'TEST' } });
      const found = await prisma.project.findUnique({ where: { id: project.id } });
      expect(found?.name).toBe('test-project');

      const recipient = await prisma.recipient.create({
        data: {
          projectId: project.id,
          walletAddress: '0x0000000000000000000000000000000000000001',
        },
      });
      expect(recipient.id).toBeTruthy();

      await prisma.$disconnect();
    } finally {
      await container.stop();
    }
  });
});
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashApiKey } from '../src/api-key';

const POLYGON_AMOY_USDC = '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582';
const POLYGON_AMOY_RECIPIENT = '0xDA1Ec5f29E1f9119753beD3Fb589e69d0A71aE19';

const prisma = new PrismaClient();

async function main() {
  const apiKey = `pm_dev_${randomBytes(16).toString('hex')}`;

  // Idempotent: remove any previous dev client so re-seeding gives a fresh key.
  await prisma.client.deleteMany({ where: { name: 'PayMesh Development' } });

  const client = await prisma.client.create({
    data: {
      name: 'PayMesh Development',
      apiKeys: {
        create: { keyHash: hashApiKey(apiKey), scopes: ['deposits', 'quote', 'webhooks', 'recipients', 'management'] },
      },
      webhooks: {
        create: {
          url: 'http://localhost:9999/hooks',
          events: ['quote.ready', 'tx.submitted', 'deposit.settled', 'deposit.failed'],
          secret: 'dev-webhook-secret',
        },
      },
    },
  });

  const recipient = await prisma.recipient.create({
    data: {
      clientId: client.id,
      walletAddress: POLYGON_AMOY_RECIPIENT,
      settlementType: 'EOA',
      preferredChainId: 80002,
      preferredToken: POLYGON_AMOY_USDC,
    },
  });

  await prisma.depositIntent.create({
    data: {
      clientId: client.id,
      recipientId: recipient.id,
      idempotencyKey: 'seed-intent-1',
      toChainId: 80002,
      toToken: POLYGON_AMOY_USDC,
      minAmount: '1000000',
      maxAmount: '100000000',
    },
  });

  console.log('Seeded client id:', client.id);
  console.log('Seeded recipient id:', recipient.id);
  console.log('API key (shown once):', apiKey);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashApiKey } from '../src/api-key';

const prisma = new PrismaClient();

async function main() {
  const apiKey = `pm_dev_${randomBytes(16).toString('hex')}`;

  const client = await prisma.client.create({
    data: {
      name: 'PayMesh Development',
      apiKeys: {
        create: { keyHash: hashApiKey(apiKey), scopes: ['deposits', 'quote', 'webhooks', 'recipients'] },
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
      walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      settlementType: 'EOA',
      preferredChainId: 84532,
      preferredToken: 'USDC',
    },
  });

  await prisma.depositIntent.create({
    data: {
      clientId: client.id,
      recipientId: recipient.id,
      idempotencyKey: 'seed-intent-1',
      toChainId: 84532,
      toToken: 'USDC',
      minAmount: 1_000_000n,
      maxAmount: 100_000_000n,
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
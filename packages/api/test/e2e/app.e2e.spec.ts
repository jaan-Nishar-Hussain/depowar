import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaClient, hashApiKey } from '@paymesh/db';
import { AppModule } from '../../dist/app.module';
import { GlobalExceptionFilter } from '../../dist/common/exception.filter';
import { RequestIdMiddleware } from '../../dist/common/request-id.middleware';
import { ROUTING_PROVIDER } from '../../dist/common/tokens';
import type { RoutingProvider } from '../../dist/quote/routing.provider';
import type { Quote, QuoteRequest } from '@paymesh/routing-engine';

const API_KEY = `pm_test_${randomUUID().replace(/-/g, '')}`;

const fakeRoutingProvider: RoutingProvider = {
  async getQuote(req: QuoteRequest): Promise<{ best: Quote; alternates: Quote[] }> {
    const best: Quote = {
      request: req,
      route: [
        {
          type: 'bridge',
          fromChain: req.fromChain,
          toChain: req.toChain,
          fromToken: req.fromToken,
          toToken: req.toToken,
          amountIn: req.fromAmount,
          amountOut: 1_980_000n,
          protocol: 'fake-bridge',
        },
      ],
      estimatedOutput: 1_980_000n,
      estimatedTimeSeconds: 95,
      estimatedFee: 6_000n,
      reliability: 0.95,
      adapterId: 'fake-bridge',
      slippageBps: req.slippageBps ?? 50,
      transactionRequest: {
        to: '0x2222222222222222222222222222222222222222',
        data: '0xdeadbeef',
        value: 0n,
        chainId: req.fromChain,
        from: req.fromAddress,
      },
    };
    return { best, alternates: [] };
  },
};

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

let app: INestApplication;
let prisma: PrismaClient;
let recipientId: string;
let depositId: string;
let quoteId: string;

beforeAll(async () => {
  let postgres: PostgreSqlContainer | undefined;
  let redis: RedisContainer | undefined;
  try {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    redis = await new RedisContainer('redis:7-alpine').start();
  } catch (error) {
    console.warn('Docker unavailable — skipping API e2e suite.', (error as Error).message);
    return;
  }

  const databaseUrl = postgres.getConnectionUri();
  const redisUrl = redis.getConnectionUrl();

  execFileSync('pnpm', ['--filter', '@paymesh/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.SCREENING_DENY_LIST = '0x1234567890123456789012345678901234567890';

  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const client = await prisma.client.create({ data: { name: 'e2e-client' } });
  await prisma.apiKey.create({
    data: { clientId: client.id, keyHash: hashApiKey(API_KEY), scopes: ['deposits', 'quote', 'webhooks', 'recipients'] },
  });
  const recipient = await prisma.recipient.create({
    data: {
      clientId: client.id,
      walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      preferredChainId: 84532,
      preferredToken: 'USDC',
    },
  });
  recipientId = recipient.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ROUTING_PROVIDER)
    .useValue(fakeRoutingProvider)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  app.use(RequestIdMiddleware);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
});

function http() {
  return request(app.getHttpServer());
}

describe('PayMesh API e2e', () => {
  it('exposes a public health endpoint', async () => {
    const res = await http().get('/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects requests without an API key', async () => {
    await http().get('/v1/chains').expect(401);
  });

  it('rejects requests with an invalid API key', async () => {
    await http().get('/v1/chains').set('x-api-key', 'nope').expect(401);
  });

  it('lists supported chains and tokens', async () => {
    const chains = await http().get('/v1/chains').set('x-api-key', API_KEY).expect(200);
    expect(chains.body.map((c: { id: number }) => c.id)).toEqual(
      expect.arrayContaining([31337, 11155111, 84532, 421614]),
    );

    const tokens = await http()
      .get('/v1/tokens')
      .query({ chainId: 84532 })
      .set('x-api-key', API_KEY)
      .expect(200);
    expect(tokens.body.map((t: { symbol: string }) => t.symbol)).toContain('USDC');
  });

  it('creates a deposit intent and honors idempotency keys', async () => {
    const payload = {
      recipientId,
      toChain: 84532,
      toToken: 'USDC',
      minAmount: '5000000',
      idempotencyKey: 'idem-fixed-key',
    };

    const first = await http().post('/v1/deposit-intents').set('x-api-key', API_KEY).send(payload).expect(201);
    expect(first.body.depositId).toBeTruthy();
    expect(first.body.created).toBe(true);
    depositId = first.body.depositId;

    const replay = await http().post('/v1/deposit-intents').set('x-api-key', API_KEY).send(payload).expect(201);
    expect(replay.body.depositId).toBe(first.body.depositId);
    expect(replay.body.created).toBe(false);
  });

  it('rejects deposit intents for unknown recipients', async () => {
    await http()
      .post('/v1/deposit-intents')
      .set('x-api-key', API_KEY)
      .send({ recipientId: 'rec_does_not_exist', toChain: 84532, toToken: 'USDC' })
      .expect(404);
  });

  it('returns a typed validation error for bad input', async () => {
    const res = await http()
      .post('/v1/deposit-intents')
      .set('x-api-key', API_KEY)
      .send({ recipientId: '', toChain: 'not-a-number', toToken: '' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.userMessage).toBeTruthy();
  });

  it('quotes a route and transitions the deposit to AWAITING_SIGNATURE', async () => {
    const res = await http()
      .get('/v1/quote')
      .query({
        depositId,
        fromChain: 11155111,
        fromToken: '0x1111111111111111111111111111111111111111',
        fromAmount: '1000000000000000000',
        fromAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      })
      .set('x-api-key', API_KEY)
      .expect(200);

    expect(res.body.quoteId).toBeTruthy();
    expect(res.body.estimatedOutput).toBe('1980000');
    expect(res.body.transactionRequest).toBeDefined();
    expect(res.body.route).toHaveLength(1);
    quoteId = res.body.quoteId;

    const status = await http().get('/v1/status').query({ depositId }).set('x-api-key', API_KEY).expect(200);
    expect(status.body.status).toBe('AWAITING_SIGNATURE');
  });

  it('blocks screened addresses before execution', async () => {
    const res = await http()
      .get('/v1/quote')
      .query({
        depositId,
        fromChain: 11155111,
        fromToken: '0x1111111111111111111111111111111111111111',
        fromAmount: '1000000000000000000',
        fromAddress: '0x1234567890123456789012345678901234567890',
      })
      .set('x-api-key', API_KEY)
      .expect(403);
    expect(res.body.error.code).toBe('SCREENING_BLOCKED');
  });

  it('records a submitted transaction and moves the deposit IN_FLIGHT', async () => {
    const txHash = `0x${'ab'.repeat(32)}`;
    const res = await http()
      .post(`/v1/quote/${quoteId}/transactions`)
      .set('x-api-key', API_KEY)
      .send({ hopIndex: 0, txHash })
      .expect(201);

    expect(res.body.status).toBe('SUBMITTED');

    const status = await http().get('/v1/status').query({ depositId }).set('x-api-key', API_KEY).expect(200);
    expect(status.body.status).toBe('IN_FLIGHT');
  });

  it('rejects unknown hops when reporting transactions', async () => {
    await http()
      .post(`/v1/quote/${quoteId}/transactions`)
      .set('x-api-key', API_KEY)
      .send({ hopIndex: 9, txHash: `0x${'cd'.repeat(32)}` })
      .expect(404);
  });

  it('fails server-custody execution when no signer is configured', async () => {
    const res = await http()
      .post(`/v1/quote/${quoteId}/execute`)
      .set('x-api-key', API_KEY)
      .expect(501);
    expect(res.body.error.code).toBe('SIGNER_NOT_CONFIGURED');
  });

  it('rejects expired quotes on server-custody execution', async () => {
    await prisma!.quote.update({ where: { id: quoteId }, data: { status: 'EXPIRED' } });
    const res = await http()
      .post(`/v1/quote/${quoteId}/execute`)
      .set('x-api-key', API_KEY)
      .expect(409);
    expect(res.body.error.code).toBe('QUOTE_EXPIRED');
  });

  it('registers, lists and deletes webhooks', async () => {
    const created = await http()
      .post('/v1/webhooks')
      .set('x-api-key', API_KEY)
      .send({ url: 'https://example.com/hooks', events: ['deposit.settled', 'deposit.failed'] })
      .expect(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.secret).toBeTruthy();

    const listed = await http().get('/v1/webhooks').set('x-api-key', API_KEY).expect(200);
    expect(listed.body.length).toBeGreaterThanOrEqual(1);

    const removed = await http()
      .delete(`/v1/webhooks/${created.body.id}`)
      .set('x-api-key', API_KEY)
      .expect(200);
    expect(removed.body.deleted).toBe(true);
  });

  it('updates a recipient settlement config', async () => {
    const res = await http()
      .put(`/v1/recipients/${recipientId}/settlement`)
      .set('x-api-key', API_KEY)
      .send({ chainId: 84532, token: 'USDC', settlementType: 'EOA', minAmount: '1000000' })
      .expect(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.token).toBe('USDC');
  });

  it('returns a 404 for unknown deposits in status', async () => {
    const res = await http()
      .get('/v1/status')
      .query({ depositId: 'dep_missing' })
      .set('x-api-key', API_KEY)
      .expect(404);
    expect(res.body.error.code).toBe('DEPOSIT_NOT_FOUND');
  });
});
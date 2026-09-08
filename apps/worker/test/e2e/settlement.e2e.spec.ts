import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import { createServer } from 'node:http';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { createAnvil } from '@viem/anvil';
import { parseEther, maxUint256, type Address } from 'viem';
import { PrismaClient, hashApiKey } from '@paymesh/db';
import { loadEnv, getChain } from '@paymesh/config';
import { deployTestSuite, readArtifact, type TestDeployment } from '@paymesh/contracts';
import { getQuote, createDefaultAdapters, type QuoteRequest } from '@paymesh/routing-engine';
import { startWorkers } from '../../src/index';
import { createWorkerContext, enqueueMonitor, type WorkerContext } from '../../src/context';

const API_KEY = 'pm_e2e_worker_key';
const RELAYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const anvilA = createAnvil({ chainId: 31337, port: 8545 });
const anvilB = createAnvil({ chainId: 31338, port: 8546 });

let prisma: PrismaClient;
let src: TestDeployment;
let dst: TestDeployment;
let ctx: WorkerContext;
let workerDispose: () => Promise<void>;
let delivered: Array<{ type: string; body: unknown }> = [];
let webhookServer: http.Server;
let webhookPort: number;

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

beforeAll(async () => {
  let postgres: PostgreSqlContainer | undefined;
  let redis: RedisContainer | undefined;
  try {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    redis = await new RedisContainer('redis:7-alpine').start();
    await anvilA.start();
    await anvilB.start();
  } catch (error) {
    console.warn('Docker/Anvil unavailable — skipping worker e2e suite.', (error as Error).message);
    return;
  }

  const databaseUrl = postgres.getConnectionUri();
  const redisUrl = redis.getConnectionUrl();

  execFileSync('pnpm', ['--filter', '@paymesh/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  src = await deployTestSuite({ rpcUrl: 'http://127.0.0.1:8545', chainId: 31337 });
  dst = await deployTestSuite({ rpcUrl: 'http://127.0.0.1:8546', chainId: 31338 });

  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    ANVIL_RPC_URL: 'http://127.0.0.1:8545',
    ANVIL_CHAIN_ID: 31337,
    PAYMESH_SOURCE_CHAIN_ID: 31337,
    PAYMESH_DEST_CHAIN_ID: 31338,
    PAYMESH_DEX_ADDRESS: src.mockDex,
    PAYMESH_BRIDGE_ADDRESS: src.mockBridge,
    PAYMESH_DEST_BRIDGE_ADDRESS: dst.mockBridge,
    RELAYER_PRIVATE_KEY: RELAYER_KEY,
    TX_MONITOR_TIMEOUT_MS: 15_000,
  } as never);

  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  // Webhook receiver
  webhookServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(raw) as { type: string };
        delivered.push({ type: parsed.type, body: parsed });
      } catch {
        /* ignore malformed */
      }
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => webhookServer.listen(0, resolve));
  webhookPort = (webhookServer.address() as { port: number }).port;

  const client = await prisma.client.create({ data: { name: 'worker-e2e' } });
  await prisma.apiKey.create({
    data: { clientId: client.id, keyPrefix: API_KEY.slice(0, 12), keyHash: hashApiKey(API_KEY), scopes: ['*'] },
  });
  await prisma.webhookSubscription.create({
    data: {
      clientId: client.id,
      url: `http://127.0.0.1:${webhookPort}/hooks`,
      events: ['quote.ready', 'tx.confirmed', 'deposit.settled', 'deposit.failed'],
      secret: 'worker-e2e-secret',
    },
  });

  ctx = createWorkerContext(env, prisma);
  const workers = startWorkers(ctx);
  workerDispose = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await ctx.eventQueue.close();
  };
}, 120_000);

afterAll(async () => {
  if (workerDispose) await workerDispose();
  if (prisma) await prisma.$disconnect();
  if (webhookServer) await new Promise((r) => webhookServer.close(r));
  await anvilA.stop();
  await anvilB.stop();
});

async function createDepositWithQuote(fromToken: Address, fromAmount: bigint, txHash0?: Address) {
  const recipient = await prisma.recipient.create({
    data: {
      clientId: (await prisma.client.findFirstOrThrow()).id,
      walletAddress: src.deployer,
    },
  });
  const deposit = await prisma.depositIntent.create({
    data: {
      clientId: (await prisma.client.findFirstOrThrow()).id,
      recipientId: recipient.id,
      idempotencyKey: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      toChainId: 31338,
      toToken: dst.mockUsdc,
      status: 'PENDING',
    },
  });

  const adapters = createDefaultAdapters({
    rpcUrl: 'http://127.0.0.1:8545',
    sourceChainId: 31337,
    dexAddress: src.mockDex,
    bridgeAddress: src.mockBridge,
    destChainId: 31338,
  });

  const request: QuoteRequest = {
    fromChain: 31337,
    fromToken,
    fromAmount,
    toChain: 31338,
    toToken: dst.mockUsdc,
    fromAddress: src.deployer,
    toAddress: src.deployer,
  };

  const { best } = await getQuote(request, adapters);
  const hopTxIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        id: `qt_${Date.now()}`,
        depositIntentId: deposit.id,
        fromChainId: 31337,
        fromToken: request.fromToken,
        fromAmount: fromAmount.toString(),
        fromAddress: request.fromAddress,
        toAddress: request.toAddress,
        routePath: JSON.parse(JSON.stringify(best.route, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
        estimatedFee: best.estimatedFee.toString(),
        estimatedTimeSeconds: best.estimatedTimeSeconds,
        estimatedOutput: best.estimatedOutput.toString(),
        slippageBps: best.slippageBps,
        reliability: best.reliability,
        transactionRequest: JSON.parse(JSON.stringify(best.transactionRequest, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
        hopTransactionRequests: JSON.parse(JSON.stringify(best.hopTransactionRequests ?? [], (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    for (let i = 0; i < best.route.length; i++) {
      const hop = best.route[i]!;
      const row = await tx.transaction.create({
        data: {
          quoteId: quote.id,
          depositIntentId: deposit.id,
          hopIndex: i,
          chainId: hop.chainId ?? 31337,
          status: 'PENDING',
        },
      });
      hopTxIds.push(row.id);
    }
  });

  return { deposit, best, hopTxIds };
}

describe('worker settlement (Anvil + mocks + Postgres + Redis)', () => {
  it('settles a cross-chain deposit end-to-end and fires deposit.settled', async () => {
    const { deposit, best, hopTxIds } = await createDepositWithQuote(src.mockWeth, parseEther('1'));
    const txs = best.hopTransactionRequests!;
    expect(txs.length).toBeGreaterThanOrEqual(2); // approvals + swap + bridge

    // Sign every hop in order: approval → swap → approval → bridge. The worker
    // confirms each hop before the next one becomes signable.
    for (let i = 0; i < txs.length; i++) {
      const isLast = i === txs.length - 1;
      const hash = await src.walletClient.sendTransaction({ to: txs[i]!.to, data: txs[i]!.data, value: txs[i]!.value, gas: 1_000_000n });
      await prisma.transaction.update({
        where: { id: hopTxIds[i]! },
        data: { txHash: hash, status: 'SUBMITTED', submittedAt: new Date() },
      });
      await enqueueMonitor(ctx, hopTxIds[i]!);
      if (!isLast) {
        await waitFor(async () => (await prisma.depositIntent.findUnique({ where: { id: deposit.id } }))?.status === 'AWAITING_SIGNATURE');
      }
    }

    // worker confirms bridge, settles on dest chain, marks SETTLED
    await waitFor(async () => (await prisma.depositIntent.findUnique({ where: { id: deposit.id } }))?.status === 'SETTLED');

    const erc20Abi = readArtifact('MockERC20').abi;
    const recipientBalance = (await dst.publicClient.readContract({
      address: dst.mockUsdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [src.deployer],
    })) as bigint;
    expect(recipientBalance).toBeGreaterThan(0n);

    await waitFor(async () => delivered.some((d) => d.type === 'deposit.settled'));
    expect(delivered.some((d) => d.type === 'deposit.settled')).toBe(true);
  }, 90_000);

  it('marks a deposit FAILED when no fallback route exists and fires deposit.failed', async () => {
    // Force the DEX to reject the swap so the swap hop reverts.
    const dexAbi = readArtifact('MockDEX').abi;
    await src.walletClient.writeContract({
      address: src.mockDex,
      abi: dexAbi,
      functionName: 'setSwapFailCountdown',
      args: [1n],
    });

    const { deposit, best, hopTxIds } = await createDepositWithQuote(src.mockWeth, parseEther('0.5'));
    const txs = best.hopTransactionRequests!;
    const swapIndex = best.route.findIndex((h) => h.type === 'swap');
    if (swapIndex === -1) throw new Error('no swap hop in route');

    // Sign the swap hop (the fail countdown makes it revert). The monitor sees
    // the revert and triggers the fallback re-quote; with only mock adapters
    // there is no alternative route, so the deposit is marked FAILED.
    const hash = await src.walletClient.sendTransaction({ to: txs[swapIndex]!.to, data: txs[swapIndex]!.data, value: txs[swapIndex]!.value, gas: 1_000_000n });
    await prisma.transaction.update({
      where: { id: hopTxIds[swapIndex]! },
      data: { txHash: hash, status: 'SUBMITTED', submittedAt: new Date() },
    });
    await enqueueMonitor(ctx, hopTxIds[swapIndex]!);

    await waitFor(async () => (await prisma.depositIntent.findUnique({ where: { id: deposit.id } }))?.status === 'FAILED');

    const hop = await prisma.transaction.findUnique({ where: { id: hopTxIds[swapIndex]! } });
    expect(hop?.status).toBe('FAILED');

    await waitFor(async () => delivered.some((d) => d.type === 'deposit.failed'));
    expect(delivered.some((d) => d.type === 'deposit.failed')).toBe(true);
  }, 90_000);
});
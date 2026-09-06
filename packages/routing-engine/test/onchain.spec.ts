import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAnvil } from '@viem/anvil';
import { parseEther } from 'viem';
import {
  deployTestSuite,
  readArtifact,
  type TestDeployment,
} from '@paymesh/contracts';
import { createMockDexAdapter } from '../src/adapters/dex/mockDexAdapter';
import { createMockBridgeAdapter } from '../src/adapters/bridge/mockBridgeAdapter';
import { getQuote } from '../src/getQuote';

const anvilA = createAnvil({ chainId: 31337, port: 8545 });
const anvilB = createAnvil({ chainId: 31338, port: 8546 });

let src: TestDeployment;
let dst: TestDeployment;

beforeAll(async () => {
  await anvilA.start();
  await anvilB.start();
  src = await deployTestSuite({ rpcUrl: 'http://127.0.0.1:8545', chainId: 31337 });
  dst = await deployTestSuite({ rpcUrl: 'http://127.0.0.1:8546', chainId: 31338 });
}, 90_000);

afterAll(async () => {
  await anvilA.stop();
  await anvilB.stop();
});

const erc20Abi = readArtifact('MockERC20').abi;

describe('on-chain routing (Anvil + mock contracts)', () => {
  it('quotes and executes a same-chain swap', async () => {
    const swapAdapter = createMockDexAdapter({
      publicClient: src.publicClient,
      dexAddress: src.mockDex,
    });

    const { best } = await getQuote(
      {
        fromChain: 31337,
        fromToken: src.mockWeth,
        fromAmount: parseEther('1'),
        toChain: 31337,
        toToken: src.mockUsdc,
        fromAddress: src.deployer,
        toAddress: src.deployer,
      },
      { swapAdapters: [swapAdapter], bridgeAdapters: [] },
    );

    expect(best.route).toHaveLength(3);
    expect(best.route[0]!.type).toBe('approval');
    expect(best.route[1]!.type).toBe('swap');
    expect(best.route[2]!.type).toBe('transfer');
    expect(best.transactionRequest).toBeDefined();
    expect(best.hopTransactionRequests).toHaveLength(3);

    const approvalTx = best.hopTransactionRequests![0]!;
    const approvalHash = await src.walletClient.sendTransaction({
      to: approvalTx.to,
      data: approvalTx.data,
      value: approvalTx.value,
    });
    await src.publicClient.waitForTransactionReceipt({ hash: approvalHash });

    const before = (await src.publicClient.readContract({
      address: src.mockUsdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [src.deployer],
    })) as bigint;

    const swapTx = best.hopTransactionRequests![1]!;
    const hash = await src.walletClient.sendTransaction({ to: swapTx.to, data: swapTx.data, value: swapTx.value });
    await src.publicClient.waitForTransactionReceipt({ hash });

    const after = (await src.publicClient.readContract({
      address: src.mockUsdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [src.deployer],
    })) as bigint;

    expect(after - before).toBeGreaterThan(0n);
  });

  it('builds a two-hop swap+bridge route for cross-chain deposits', async () => {
    const swapAdapter = createMockDexAdapter({
      publicClient: src.publicClient,
      dexAddress: src.mockDex,
    });
    const bridgeAdapter = createMockBridgeAdapter({
      publicClient: src.publicClient,
      bridgeAddress: src.mockBridge,
      destChainId: 31338,
    });

    const { best } = await getQuote(
      {
        fromChain: 31337,
        fromToken: src.mockWeth,
        fromAmount: parseEther('1'),
        toChain: 31338,
        toToken: src.mockUsdc,
        fromAddress: src.deployer,
        toAddress: src.deployer,
      },
      { swapAdapters: [swapAdapter], bridgeAdapters: [bridgeAdapter] },
    );

    expect(best.route).toHaveLength(4);
    expect(best.route[0]!.type).toBe('approval');
    expect(best.route[1]!.type).toBe('swap');
    expect(best.route[2]!.type).toBe('approval');
    expect(best.route[3]!.type).toBe('bridge');
    expect(best.route[3]!.toChain).toBe(31338);
    expect(best.hopTransactionRequests![1]!.to).toBe(src.mockDex);
  });

  it('returns a direct ERC20 transfer when chain and token match', async () => {
    const { best } = await getQuote(
      {
        fromChain: 31337,
        fromToken: src.mockUsdc,
        fromAmount: 5_000_000n,
        toChain: 31337,
        toToken: src.mockUsdc,
        toAddress: src.deployer,
      },
      { swapAdapters: [], bridgeAdapters: [] },
    );

    expect(best.adapterId).toBe('direct');
    expect(best.transactionRequest!.to).toBe(src.mockUsdc);
  });
});
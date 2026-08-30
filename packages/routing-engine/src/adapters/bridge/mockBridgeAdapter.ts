import { encodeFunctionData, type Address, type PublicClient } from 'viem';
import { readArtifact } from '@paymesh/contracts';
import type { QuoteRequest, TransactionRequest } from '../../types';
import type { BridgeAdapter, BridgeQuote } from '../types';

export interface MockBridgeAdapterOptions {
  publicClient: PublicClient;
  /** Source-chain bridge deployment. */
  bridgeAddress: Address;
  /** Chain the bridge delivers to. */
  destChainId: number;
  supportedFromChains?: number[];
  supportedToChains?: number[];
}

const BRIDGE_ABI = readArtifact('MockBridge').abi;
const ERC20_APPROVE_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

/**
 * Cross-chain bridge adapter against the MockBridge. The source-side
 * `deposit` call locks tokens and emits `TransferInitiated`; settlement on the
 * destination is performed by the PayMesh worker acting as the relayer.
 */
export function createMockBridgeAdapter(options: MockBridgeAdapterOptions): BridgeAdapter {
  const supportedFromChains = options.supportedFromChains ?? [options.publicClient.chain?.id ?? 31337];
  const supportedToChains = options.supportedToChains ?? [options.destChainId];

  async function quoteBridge(req: {
    fromChain: number;
    toChain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<BridgeQuote> {
    // The mock bridge carries the same token across chains with no fee.
    return { amountOut: req.amountIn, fee: 0n, timeSeconds: 90, reliability: 1 };
  }

  async function buildBridgeTransaction(
    req: QuoteRequest,
    quote: BridgeQuote,
  ): Promise<TransactionRequest> {
    if (!req.toAddress) {
      throw new Error('Bridge hop requires a destination address');
    }
    const data = encodeFunctionData({
      abi: BRIDGE_ABI,
      functionName: 'deposit',
      args: [
        req.fromToken as Address,
        quote.amountOut,
        options.destChainId,
        req.toToken as Address,
        req.toAddress as Address,
      ],
    });
    return {
      to: options.bridgeAddress,
      data,
      value: 0n,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  async function buildApprovalTransaction(req: QuoteRequest, amount: bigint): Promise<TransactionRequest> {
    if (req.fromToken === 'native') {
      throw new Error('Native input does not require an ERC-20 approval');
    }
    return {
      to: req.fromToken as Address,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [options.bridgeAddress, amount],
      }),
      value: 0n,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }

  return {
    id: `mock-bridge-${options.destChainId}-${options.bridgeAddress.toLowerCase().slice(0, 10)}`,
    supportedFromChains,
    supportedToChains,
    quoteBridge,
    buildBridgeTransaction,
    buildApprovalTransaction,
  };
}

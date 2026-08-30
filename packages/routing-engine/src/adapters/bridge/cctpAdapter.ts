import { encodeFunctionData, pad, type Address, type Hex, type PublicClient } from 'viem';
import type { QuoteRequest, TransactionRequest } from '../../types';
import type { BridgeAdapter, BridgeQuote } from '../types';

const TOKEN_MESSENGER_V2_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getMinFeeAmount',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'minFeeAmount', type: 'uint256' }],
  },
] as const;

const ERC20_APPROVE_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export interface CctpAdapterOptions {
  publicClient: PublicClient;
  tokenMessenger: Address;
  sourceUsdc: Address;
  destinationUsdc: Address;
  sourceChainId: number;
  destinationChainId: number;
  destinationDomain: number;
  /** Standard CCTP finality is 2000. Fast transfers use 1000. */
  minFinalityThreshold?: number;
  /** Used when the deployed TokenMessenger does not expose getMinFeeAmount. */
  maxFee?: bigint;
  id?: string;
}

/**
 * Circle CCTP V2 source-side adapter. CCTP carries native Circle USDC only;
 * callers should compose a DEX swap before this adapter for USDT input.
 */
export function createCctpAdapter(options: CctpAdapterOptions): BridgeAdapter {
  const finality = options.minFinalityThreshold ?? 2000;

  async function quoteBridge(req: {
    fromChain: number;
    toChain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<BridgeQuote> {
    if (req.fromChain !== options.sourceChainId || req.toChain !== options.destinationChainId) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    if (req.tokenIn.toLowerCase() !== options.sourceUsdc.toLowerCase()) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    if (req.tokenOut.toLowerCase() !== options.destinationUsdc.toLowerCase()) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }

    let fee = options.maxFee ?? 0n;
    try {
      fee = await options.publicClient.readContract({
        address: options.tokenMessenger,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: 'getMinFeeAmount',
        args: [req.amountIn],
      });
    } catch {
      // Older V2 deployments may not expose the fee-switch view. The
      // configured maxFee remains the explicit fallback in that case.
    }

    return {
      amountOut: req.amountIn - (fee > req.amountIn ? req.amountIn : fee),
      fee,
      timeSeconds: finality >= 2000 ? 900 : 120,
      reliability: 0.995,
      liquidityScore: 1,
      priceImpactBps: 0,
      available: fee <= req.amountIn,
      metadata: {
        protocol: 'cctp-v2',
        sourceDomain: options.sourceChainId,
        destinationDomain: options.destinationDomain,
        finalityThreshold: finality,
      },
    };
  }

  function sourceTokenFor(req: { fromChain: number; toChain: number; tokenOut: string }): string {
    if (req.fromChain !== options.sourceChainId || req.toChain !== options.destinationChainId ||
        req.tokenOut.toLowerCase() !== options.destinationUsdc.toLowerCase()) return '';
    return options.sourceUsdc;
  }

  async function buildBridgeTransaction(req: QuoteRequest, quote: BridgeQuote): Promise<TransactionRequest> {
    if (!req.fromAddress || !req.toAddress) throw new Error('CCTP requires source and destination addresses');
    if (req.fromToken.toLowerCase() !== options.sourceUsdc.toLowerCase()) {
      throw new Error('CCTP can burn only the configured native Circle USDC token');
    }
    const mintRecipient = pad(req.toAddress as Hex, { size: 32 });
    const data = encodeFunctionData({
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: 'depositForBurn',
      args: [
        quote.amountOut + quote.fee,
        options.destinationDomain,
        mintRecipient,
        options.sourceUsdc,
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        quote.fee,
        finality,
      ],
    });
    return {
      to: options.tokenMessenger,
      data,
      value: 0n,
      chainId: options.sourceChainId,
      from: req.fromAddress,
    };
  }

  async function buildApprovalTransaction(req: QuoteRequest, amount: bigint): Promise<TransactionRequest> {
    if (!req.fromAddress) throw new Error('CCTP approval requires a source address');
    return {
      to: options.sourceUsdc,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [options.tokenMessenger, amount],
      }),
      value: 0n,
      chainId: options.sourceChainId,
      from: req.fromAddress,
    };
  }

  return {
    id: options.id ?? `cctp-v2-${options.sourceChainId}-${options.destinationChainId}`,
    supportedFromChains: [options.sourceChainId],
    supportedToChains: [options.destinationChainId],
    quoteBridge,
    buildBridgeTransaction,
    buildApprovalTransaction,
    sourceTokenFor,
  };
}

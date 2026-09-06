import { encodeFunctionData, pad, type Address, type Hex, type PublicClient } from 'viem';
import type { QuoteRequest, TransactionRequest } from '../../types';
import type { BridgeAdapter, BridgeQuote } from '../types';

const CCIP_MESSAGE_COMPONENTS = [
  { name: 'receiver', type: 'bytes32' },
  { name: 'data', type: 'bytes' },
  { name: 'tokenAmounts', type: 'tuple[]', components: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ] },
  { name: 'feeToken', type: 'address' },
  { name: 'extraArgs', type: 'bytes' },
] as const;

const ROUTER_ABI = [
  {
    type: 'function', name: 'getFee', stateMutability: 'view',
    inputs: [
      { name: 'destinationChainSelector', type: 'uint64' },
      { name: 'message', type: 'tuple', components: CCIP_MESSAGE_COMPONENTS },
    ],
    outputs: [{ name: 'fee', type: 'uint256' }],
  },
  {
    type: 'function', name: 'ccipSend', stateMutability: 'payable',
    inputs: [
      { name: 'destinationChainSelector', type: 'uint64' },
      { name: 'message', type: 'tuple', components: CCIP_MESSAGE_COMPONENTS },
    ],
    outputs: [{ name: 'messageId', type: 'bytes32' }],
  },
] as const;

const ERC20_APPROVE_ABI = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export interface CcipAdapterOptions {
  publicClient: PublicClient;
  /** CCIP Router on the source chain. */
  routerAddress: Address;
  /** Chain selector of the source chain, e.g. 5009297550711655893 for ETH. */
  sourceChainSelector: bigint;
  /** Chain selector of the destination chain. */
  destinationChainSelector: bigint;
  sourceChainId: number;
  destinationChainId: number;
  /** The token this deployment can carry (e.g. native USDC per registry). */
  token: Address;
  destinationToken: Address;
  enabled: boolean;
  id?: string;
}

function zeroReceiver(): Hex {
  return pad('0x0000000000000000000000000000000000000000' as Hex, { size: 32 });
}

/**
 * Chainlink CCIP bridge adapter (PRD backup rail). Disabled by default:
 * CCIP requires per-chain router + selector configuration and is intentionally
 * a fallback rail behind CCTP/Across. Carries a single configured token
 * (typically USDC) same-token across chains.
 */
export function createCcipAdapter(options: CcipAdapterOptions): BridgeAdapter {
async function quoteBridge(req: {
    fromChain: number;
    toChain: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<BridgeQuote> {
    if (!options.enabled) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    if (req.tokenIn.toLowerCase() !== options.token.toLowerCase() ||
        req.tokenOut.toLowerCase() !== options.destinationToken.toLowerCase()) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 0, reliability: 0, available: false };
    }
    let fee = 0n;
    try {
      fee = await options.publicClient.readContract({
        address: options.routerAddress,
        abi: ROUTER_ABI,
        functionName: 'getFee',
        args: [options.destinationChainSelector, [{
          receiver: zeroReceiver(),
          data: '0x' as Hex,
          tokenAmounts: [{ token: options.token, amount: req.amountIn }],
          feeToken: '0x0000000000000000000000000000000000000000' as Address,
          extraArgs: '0x' as Hex,
        }]] as never,
      }) as bigint;
    } catch {
      // Fee estimation is best-effort; the router enforces the real fee.
      fee = 0n;
    }
    if (fee >= req.amountIn) {
      return { amountOut: 0n, fee: req.amountIn, timeSeconds: 300, reliability: 0, available: false };
    }
    return {
      amountOut: req.amountIn - fee,
      fee,
      // CCIP settlement is oracle-driven and materially slower than CCTP.
      timeSeconds: 300,
      reliability: 0.93,
      liquidityScore: 0.8,
      priceImpactBps: 0,
      riskScore: 0.2,
      available: true,
      metadata: { protocol: 'ccip', sourceChainSelector: options.sourceChainSelector.toString() },
    };
  }
  const id = options.id ?? `ccip-${options.sourceChainId}`;
async function buildBridgeTransaction(req: QuoteRequest, quote: BridgeQuote): Promise<TransactionRequest> {
    if (!req.fromAddress || !req.toAddress) throw new Error('CCIP requires source and destination addresses');
    const data = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'ccipSend',
      args: [options.sourceChainSelector, [{
        receiver: pad(req.toAddress as Hex, { size: 32 }),
        data: '0x' as Hex,
        tokenAmounts: [{ token: options.token, amount: quote.amountOut + quote.fee }],
        feeToken: '0x0000000000000000000000000000000000000000' as Address,
        extraArgs: '0x' as Hex,
      }]] as never,
    });
    // Fees are paid in native gas when feeToken is address(0).
    return {
      to: options.routerAddress,
      data,
      value: quote.fee,
      chainId: options.sourceChainId,
      from: req.fromAddress,
    };
  }

  async function buildApprovalTransaction(req: QuoteRequest, amount: bigint): Promise<TransactionRequest> {
    if (!req.fromAddress) throw new Error('CCIP approval requires a source address');
    return {
      to: options.token,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [options.routerAddress, amount],
      }),
      value: 0n,
      chainId: options.sourceChainId,
      from: req.fromAddress,
    };
  }

  return {
    id,
    supportedFromChains: options.enabled ? [options.sourceChainId] : [],
    supportedToChains: options.enabled ? [options.destinationChainId] : [],
    quoteBridge,
    buildBridgeTransaction,
    buildApprovalTransaction,
  };
}
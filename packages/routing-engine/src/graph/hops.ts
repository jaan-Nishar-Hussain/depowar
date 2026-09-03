import { encodeFunctionData, type Address } from 'viem';
import { readArtifact } from '@paymesh/contracts';
import type { QuoteRequest, TransactionRequest } from '../types';

const ERC20_ABI = readArtifact('MockERC20').abi;

/**
 * Terminal leg shared by the direct candidate path (`getQuote`) and the
 * composed route graph (`graph/search`): sends `amountOut` of the settled
 * token to the recipient. The sender signs this on the source chain.
 */
export function buildTransferTransaction(req: QuoteRequest, amountOut: bigint): TransactionRequest | null {
  if (!req.toAddress) return null;
  if (req.toToken === 'native') {
    return {
      to: req.toAddress as Address,
      data: '0x',
      value: amountOut,
      chainId: req.fromChain,
      from: req.fromAddress,
    };
  }
  return {
    to: req.toToken as Address,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [req.toAddress as Address, amountOut],
    }),
    value: 0n,
    chainId: req.fromChain,
    from: req.fromAddress,
  };
}

export const TRANSFER_HOP_ERC20_ABI = ERC20_ABI;

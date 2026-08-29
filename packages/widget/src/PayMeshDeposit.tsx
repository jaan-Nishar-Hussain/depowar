import { useMemo, useState, useCallback } from 'react';
import { useAccount, useConnect, usePublicClient, useWalletClient } from 'wagmi';
import { PayMeshClient, type QuoteResult } from '@paymesh/sdk';
import type { PayMeshDepositApi, PayMeshDepositConfig, DepositStatus } from './types';

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

const ERC20_DECIMALS_ABI = [{ type: 'function' as const, name: 'decimals', stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint8' as const }] }];

/** Converts a human decimal amount (e.g. "0.01") into base units ("10000000000000000"). */
function toBaseUnits(input: string, decimals: number): string {
  const clean = input.trim();
  if (!/^\d*\.?\d*$/.test(clean)) throw new Error('Invalid amount. Enter a number like 0.01.');
  const [whole = '0', frac = ''] = clean.split('.');
  const fracPadded = (frac || '').padEnd(decimals, '0').slice(0, decimals);
  const base = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
  return base.toString();
}

/** Formats raw base units back to a human decimal string for display. */
function formatBaseUnits(value: string, decimals: number): string {
  const raw = BigInt(value || '0');
  const factor = 10n ** BigInt(decimals);
  const whole = raw / factor;
  const frac = (raw % factor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

async function waitForStatus(
  sdk: PayMeshDepositApi,
  depositId: string,
  target: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const status = await sdk.getStatus(depositId);
    if (status.status === target) return;
    if (status.status === 'FAILED' || status.status === 'SETTLED') {
      throw new Error('The deposit finished before all steps were signed.');
    }
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for the previous step.');
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Drop-in deposit UI. Handles wallet connect, quoting, signing each hop, and
 * status polling. Must be rendered inside a `WagmiProvider` + `QueryClientProvider`.
 */
export function PayMeshDeposit({ config }: { config: PayMeshDepositConfig }) {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const sdk = useMemo<PayMeshDepositApi>(
    () => new PayMeshClient({ baseUrl: config.apiUrl, apiKey: config.apiKey }),
    [config.apiUrl, config.apiKey],
  );

  const [amount, setAmount] = useState('');
  const [depositId, setDepositId] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [status, setStatus] = useState<DepositStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [destDecimals, setDestDecimals] = useState(6);

  const connected = isConnected && !!address && !!chain;
  const isSigning = status === 'signing';

  const resolveTokenDecimals = useCallback(
    async (token: string | undefined): Promise<number> => {
      if (!token || token === 'native' || !publicClient) return 18;
      try {
        const dec = await publicClient.readContract({
          address: token as `0x${string}`,
          abi: ERC20_DECIMALS_ABI,
          functionName: 'decimals',
        });
        return Number(dec);
      } catch {
        return 18;
      }
    },
    [publicClient],
  );

  const startDeposit = useCallback(async () => {
    if (!connected) return;
    setStatus('quoting');
    setError(null);
    try {
      const [srcDecimals, toDecimals] = await Promise.all([
        resolveTokenDecimals(config.fromToken),
        resolveTokenDecimals(config.toToken),
      ]);
      setDestDecimals(toDecimals);
      const fromAmount = toBaseUnits(amount, srcDecimals);

      const deposit = await sdk.createDepositIntent({
        recipientId: config.recipientId,
        toChain: config.toChain,
        toToken: config.toToken,
      });
      setDepositId(deposit.depositId);
      const result = await sdk.getQuote({
        depositId: deposit.depositId,
        fromChain: chain!.id,
        fromToken: config.fromToken ?? 'native',
        fromAmount,
        fromAddress: address,
        slippageBps: config.defaultSlippageBps,
      });
      setQuote(result);
      setStatus('ready');
    } catch (e) {
      setStatus('failed');
      setError(messageOf(e));
    }
  }, [connected, sdk, config, chain, address, amount, resolveTokenDecimals]);

  const confirm = useCallback(async () => {
    if (!walletClient || !quote || !depositId) return;
    setStatus('signing');
    setError(null);
    try {
      const txs =
        quote.hopTransactionRequests && quote.hopTransactionRequests.length > 0
          ? quote.hopTransactionRequests
          : quote.transactionRequest
            ? [quote.transactionRequest]
            : [];
      if (txs.length === 0) throw new Error('No transaction to sign.');

      // Sign each hop in order; wait for the previous hop to confirm on-chain
      // before signing the next (the transfer leg needs the swap output).
      for (let i = 0; i < txs.length; i++) {
        const hash = await sdk.signAndSend(walletClient, txs[i]);
        await sdk.reportTransaction(quote.quoteId, i, hash);
        if (i < txs.length - 1) {
          await waitForStatus(sdk, depositId, 'AWAITING_SIGNATURE');
        }
      }

      setStatus('inFlight');
      const final = await sdk.pollUntilSettled(depositId);
      setStatus(final.status === 'SETTLED' ? 'settled' : 'failed');
      if (final.status !== 'SETTLED') setError('Deposit failed to settle.');
    } catch (e) {
      setStatus('failed');
      setError(messageOf(e));
    }
  }, [walletClient, quote, depositId, sdk]);

  return (
    <div className="pm-deposit" data-testid="paymesh-deposit">
      <div className="pm-deposit__header">
        <span className="pm-deposit__title">Deposit</span>
        {connected && (
          <span className="pm-deposit__chain">
            {chain!.name} · {address!.slice(0, 6)}…{address!.slice(-4)}
          </span>
        )}
      </div>

      {!connected ? (
        <div className="pm-deposit__body">
          <button
            type="button"
            className="pm-btn"
            onClick={() => connect({ connector: connectors[0] })}
            disabled={!connectors[0]}
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="pm-deposit__body">
          <label className="pm-field">
            <span className="pm-field__label">Amount</span>
            <input
              className="pm-input"
              type="text"
              inputMode="decimal"
              value={amount}
              placeholder="0.0"
              aria-label="Amount"
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          {!([11155111, 84532].includes(chain!.id)) && (
            <div className="pm-status pm-status--error">
              Connect to Ethereum Sepolia or Base Sepolia to send this deposit.
            </div>
          )}

          <button
            type="button"
            className="pm-btn pm-btn--primary"
            onClick={startDeposit}
            disabled={status === 'quoting' || !amount}
          >
            {status === 'quoting' ? 'Quoting…' : 'Deposit'}
          </button>

          {quote && status === 'ready' && (
            <div className="pm-quote">
              <div className="pm-quote__row">
                <span>You receive</span>
                <strong>{formatBaseUnits(quote.estimatedOutput, destDecimals)}</strong>
              </div>
              <div className="pm-quote__row">
                <span>Estimated time</span>
                <strong>{quote.estimatedTimeSeconds}s</strong>
              </div>
              <div className="pm-quote__row">
                <span>Route</span>
                <strong>{quote.route.map((h) => h.type).join(' → ')}</strong>
              </div>
              <button
                type="button"
                className="pm-btn pm-btn--primary"
                onClick={confirm}
                disabled={isSigning}
              >
                {isSigning ? 'Confirming…' : 'Confirm'}
              </button>
            </div>
          )}

          {status === 'inFlight' && <div className="pm-status">Watching your deposit on-chain…</div>}
          {status === 'settled' && <div className="pm-status pm-status--ok">Deposit Completed</div>}
          {status === 'failed' && error && <div className="pm-status pm-status--error">{error}</div>}
        </div>
      )}
    </div>
  );
}

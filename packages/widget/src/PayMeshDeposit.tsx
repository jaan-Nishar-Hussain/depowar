import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
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

function chainLabel(chainId: number | undefined): string {
  return ({ 1: 'Ethereum', 8453: 'Base', 137: 'Polygon', 11155111: 'Sepolia', 84532: 'Base Sepolia' } as Record<number, string>)[chainId ?? 0] ?? 'Network';
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
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(8);
  const swipeRef = useRef<HTMLButtonElement>(null);

  const connected = isConnected && !!address && !!chain;
  const isSigning = status === 'signing';

  useEffect(() => {
    if (status !== 'inFlight') return undefined;
    const timer = window.setInterval(() => {
      setProcessingProgress((current) => Math.min(92, current + Math.max(1, Math.round((92 - current) / 8))));
    }, 900);
    return () => window.clearInterval(timer);
  }, [status]);

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
      if (![1, 8453, 137, 11155111, 84532].includes(chain!.id)) {
        throw new Error('Connect to Ethereum, Base, or Polygon Mainnet to send this deposit.');
      }
      const sourceToken = config.fromTokenByChain?.[chain!.id] ?? config.fromToken ?? 'native';
      const srcDecimals = await resolveTokenDecimals(sourceToken);
      setDestDecimals(config.toTokenDecimals ?? 6);
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
        fromToken: sourceToken,
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

  const resetQuote = useCallback((nextAmount: string) => {
    setAmount(nextAmount);
    setQuote(null);
    setDepositId(null);
    if (status !== 'signing' && status !== 'inFlight') setStatus('idle');
    setSwipeOffset(0);
  }, [status]);

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
        if (txs[i]!.chainId !== undefined && txs[i]!.chainId !== chain!.id) {
          throw new Error('Wallet network changed while signing the route. Reconnect to the source network.');
        }
        const hash = await sdk.signAndSend(walletClient, txs[i]);
        // Wait until the source RPC can read the transaction before asking the
        // API to validate it. Immediately reporting a fresh hash can produce a
        // transient 409/TX_NOT_FOUND from the API.
        if (publicClient && typeof publicClient.waitForTransactionReceipt === 'function') {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
          if (receipt.status !== 'success') throw new Error('The transaction reverted on-chain.');
        }
        await sdk.reportTransaction(quote.quoteId, i, hash);
        if (i < txs.length - 1) {
          await waitForStatus(sdk, depositId, 'AWAITING_SIGNATURE');
        }
      }

      setStatus('inFlight');
      setProcessingProgress(94);
      const final = await sdk.pollUntilSettled(depositId);
      if (final.status === 'SETTLED') setProcessingProgress(100);
      setStatus(final.status === 'SETTLED' ? 'settled' : 'failed');
      if (final.status !== 'SETTLED') setError('Deposit failed to settle.');
    } catch (e) {
      setStatus('failed');
      setError(messageOf(e));
    }
  }, [walletClient, quote, depositId, sdk]);

  const finishSwipe = useCallback(() => {
    setSwipeOffset(0);
    if (!isSigning && quote && status === 'ready') void confirm();
  }, [confirm, isSigning, quote, status]);

  const handleSwipe = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (isSigning || !quote || status !== 'ready') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const max = Math.max(0, rect.width - 62);
    const startX = event.clientX;
    const startOffset = swipeOffset;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(0, Math.min(max, startOffset + moveEvent.clientX - startX));
      setSwipeOffset(next);
      if (next >= max * 0.9) finishSwipe();
    };
    const end = () => {
      setSwipeOffset((current) => current >= max * 0.9 ? current : 0);
      event.currentTarget.removeEventListener('pointermove', move);
      event.currentTarget.removeEventListener('pointerup', end);
      event.currentTarget.removeEventListener('pointercancel', end);
    };
    event.currentTarget.addEventListener('pointermove', move);
    event.currentTarget.addEventListener('pointerup', end);
    event.currentTarget.addEventListener('pointercancel', end);
  }, [finishSwipe, isSigning, quote, status, swipeOffset]);

  const resetDeposit = useCallback(() => {
    setAmount('');
    setQuote(null);
    setDepositId(null);
    setProcessingProgress(8);
    setStatus('idle');
    setError(null);
  }, []);

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
          {status === 'inFlight' && (
            <div className="pm-result pm-result--processing" role="status" aria-live="polite">
              <div className="pm-result__amount">${amount || '0.00'}</div>
              <div className="pm-result__asset">{amount || '0'} USDC <span>↕</span></div>
              <div className="pm-result__balance">Processing transaction</div>
              <div className="pm-progress" style={{ '--pm-progress': `${processingProgress * 3.6}deg` } as React.CSSProperties}>
                <span>{processingProgress}%</span>
              </div>
              <div className="pm-result__message">Processing transaction…</div>
            </div>
          )}

          {status === 'settled' && (
            <div className="pm-result pm-result--complete" role="status" aria-live="polite">
              <div className="pm-confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
              <div className="pm-success-mark">✓</div>
              <h2>Deposit Complete!<span className="pm-visually-hidden">Deposit Completed</span></h2>
              <div className="pm-result__received">{formatBaseUnits(quote?.estimatedOutput ?? '0', destDecimals)} USDT</div>
              <button type="button" className="pm-btn pm-btn--primary pm-done" onClick={resetDeposit}>Done</button>
            </div>
          )}

          {status !== 'inFlight' && status !== 'settled' && (
          <>
          <label className="pm-field">
            <span className="pm-field__label">Amount</span>
            <input
              className="pm-input"
              type="text"
              inputMode="decimal"
              value={amount}
              placeholder="0.0"
              aria-label="Amount"
              onChange={(e) => resetQuote(e.target.value)}
            />
          </label>

          <div className="pm-token-card" aria-label="Payment asset">
            <span className="pm-token-card__icon">$</span>
            <span className="pm-token-card__name">USDC<small>{chainLabel(chain.id)}</small></span>
            <span className="pm-token-card__chevron">⌄</span>
          </div>

          <div className="pm-range-wrap">
            <input
              className="pm-range"
              type="range"
              min="0"
              max="150"
              step="0.01"
              value={Math.min(150, Number(amount) || 0)}
              aria-label="Amount slider"
              onChange={(e) => resetQuote(e.target.value)}
            />
            <div className="pm-range-labels"><span>$0</span><span>$50</span><span>$100</span><span>$150</span></div>
          </div>

          {(![1, 8453, 137, 11155111, 84532].includes(chain!.id)) && (
            <div className="pm-status pm-status--error">
              Connect to Ethereum, Base, or Polygon Mainnet to send this deposit.
            </div>
          )}

          <button
            type="button"
            className="pm-btn pm-btn--primary"
            onClick={startDeposit}
            disabled={status === 'quoting' || !amount || ![1, 8453, 137, 11155111, 84532].includes(chain!.id)}
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
                ref={swipeRef}
                type="button"
                className={`pm-swipe ${isSigning ? 'pm-swipe--busy' : ''}`}
                aria-label="Confirm"
                onPointerDown={handleSwipe}
                onClick={() => { if (!swipeOffset) finishSwipe(); }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finishSwipe(); } }}
                disabled={isSigning}
              >
                <span className="pm-swipe__thumb" style={{ transform: `translateX(${swipeOffset}px)` }}>→</span>
                <span className="pm-swipe__label">{isSigning ? 'Confirming…' : 'Swipe to confirm'}</span>
                <span className="pm-swipe__destination">◆</span>
              </button>
              <div className="pm-swipe__route">USDC on {chainLabel(chain.id)} → USDT on Polygon</div>
            </div>
          )}

          {status === 'failed' && error && <div className="pm-status pm-status--error">{error}</div>}
          </>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState, useCallback, useRef, useEffect, type ComponentType, type CSSProperties } from 'react';
import { useAccount, useConnect, usePublicClient, useWalletClient, useSwitchChain } from 'wagmi';
import { PayMeshClient, type QuoteResult } from '@paymesh/sdk';
import { ArbitrumCircleColorful, AvaxCircleColorful, BaseCircleColorful, EthereumCircleColorful, OptimismCircleColorful, PolygonCircleColorful, UsdcCircleColorful, UsdtCircleColorful } from '@ant-design/web3-icons';
import type { PayMeshDepositApi, PayMeshDepositConfig, DepositStatus } from './types';

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

const ERC20_DECIMALS_ABI = [{ type: 'function' as const, name: 'decimals', stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint8' as const }] }];
const SUPPORTED_MAINNET_CHAINS = [1, 8453, 137, 43114, 42161, 10, 59144, 143];

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
  return ({ 1: 'Ethereum', 8453: 'Base', 137: 'Polygon', 43114: 'Avalanche', 42161: 'Arbitrum', 10: 'Optimism', 59144: 'Linea', 143: 'Monad' } as Record<number, string>)[chainId ?? 0] ?? 'Network';
}

function chainIcon(chainId: number): string {
  return ({ 1: 'Ξ', 8453: 'B', 137: 'P', 11155111: 'Ξ', 84532: 'B', 80002: 'P', 43114: 'A', 42161: 'ARB', 10: 'OP', 59144: 'L', 143: 'M' } as Record<number, string>)[chainId] ?? '◆';
}

function NetworkIcon({ chainId, size = 32 }: { chainId: number; size?: number }) {
  const icons: Record<number, ComponentType<{ style?: CSSProperties; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
    1: EthereumCircleColorful, 8453: BaseCircleColorful,
    137: PolygonCircleColorful, 43114: AvaxCircleColorful, 42161: ArbitrumCircleColorful,
    10: OptimismCircleColorful,
  };
  const Icon = icons[chainId];
  return Icon ? <Icon style={{ fontSize: size }} aria-hidden /> : <span aria-hidden="true">{chainIcon(chainId)}</span>;
}

function TokenIcon({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const Icon = symbol === 'USDT' ? UsdtCircleColorful : UsdcCircleColorful;
  return <Icon style={{ fontSize: size }} aria-hidden />;
}

function tokenLabel(address: string | undefined): string {
  if (!address || address === 'native') return 'ETH';
  const normalized = address.toLowerCase();
  if (normalized === '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2' || normalized === '0xc2132d05d31c914a87c6611c10748aeb04b58e8f') return 'USDT';
  return 'USDC';
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
  const { switchChain } = useSwitchChain();
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
  const [selectorOpen, setSelectorOpen] = useState(false);
  const swipeRef = useRef<HTMLButtonElement>(null);

  const connected = isConnected && !!address && !!chain;
  const isSigning = status === 'signing';
  const supportedChains = SUPPORTED_MAINNET_CHAINS;
  const baseSourceToken = config.fromTokenByChain?.[chain?.id ?? 0] ?? config.fromToken ?? 'native';
  const tokenOptions = config.supportedTokensByChain?.[chain?.id ?? 0]?.filter((token) => token.address) ?? [{ symbol: tokenLabel(baseSourceToken), address: baseSourceToken }];
  const [selectedToken, setSelectedToken] = useState<string>();
  const sourceToken = selectedToken ?? tokenOptions[0]?.address ?? baseSourceToken;
  const sourceSymbol = tokenOptions.find((token) => token.address.toLowerCase() === sourceToken.toLowerCase())?.symbol ?? tokenLabel(sourceToken);

  useEffect(() => {
    setSelectedToken(undefined);
  }, [chain?.id]);

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
      if (!supportedChains.includes(chain!.id)) {
        throw new Error('Connect to a supported mainnet network to send this deposit.');
      }
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
    if (isSigning || status === 'quoting') return;
    if (quote && status === 'ready') {
      void confirm();
    } else if (!quote && amount) {
      void startDeposit();
    }
  }, [amount, confirm, isSigning, quote, startDeposit, status]);

  const handleSwipe = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (isSigning || status === 'quoting' || (quote && status !== 'ready') || (!quote && !amount)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const max = Math.max(0, rect.width - 50);
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
  }, [amount, finishSwipe, isSigning, quote, status, swipeOffset]);

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

          <button type="button" className="pm-token-card" aria-label="Select chain and token" onClick={() => setSelectorOpen(true)}>
            <span className="pm-token-card__icon"><TokenIcon symbol={sourceSymbol} size={38} /></span>
            <span className="pm-token-card__name">{sourceSymbol}<small>{chainLabel(chain.id)}</small></span>
            <span className="pm-token-card__chevron">⌄</span>
          </button>

          {selectorOpen && (
            <div className="pm-selector-backdrop" role="presentation" onClick={() => setSelectorOpen(false)}>
              <section className="pm-selector" role="dialog" aria-modal="true" aria-labelledby="pm-selector-title" onClick={(event) => event.stopPropagation()}>
                <div className="pm-selector__header">
                  <button type="button" className="pm-selector__back" aria-label="Close selector" onClick={() => setSelectorOpen(false)}>‹</button>
                  <h2 id="pm-selector-title">Select Token</h2>
                  <span className="pm-selector__mode">☾</span>
                </div>
                <div className="pm-selector__search"><span>⌕</span><input aria-label="Search chain or token" placeholder="Search chain or token" /></div>
                <div className="pm-selector__columns">
                  <div className="pm-selector__chains">
                    <div className="pm-selector__section-title">Popular chains</div>
                    {supportedChains.map((chainId) => (
                      <button key={chainId} type="button" className={`pm-chain-option ${chain?.id === chainId ? 'pm-chain-option--active' : ''}`} onClick={() => { switchChain?.({ chainId }); setSelectorOpen(false); }}>
                        <span className={`pm-chain-option__icon pm-chain-option__icon--${chainId}`}><NetworkIcon chainId={chainId} size={32} /></span>
                        {chainLabel(chainId)}
                      </button>
                    ))}
                  </div>
                  <div className="pm-selector__tokens">
                    <div className="pm-selector__section-title">Your tokens</div>
                    {tokenOptions.map((token) => (
                      <button key={token.address} type="button" className={`pm-token-option ${token.address.toLowerCase() === sourceToken.toLowerCase() ? 'pm-token-option--active' : ''}`} onClick={() => { setSelectedToken(token.address); setSelectorOpen(false); }}>
                        <span className={`pm-token-option__icon pm-token-option__icon--${token.symbol.toLowerCase()}`}><TokenIcon symbol={token.symbol} size={40} /></span>
                        <span><strong>{token.symbol}</strong><small>{token.decimals ?? 6} decimals · {chainLabel(chain.id)}</small></span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}

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

          {(!SUPPORTED_MAINNET_CHAINS.includes(chain!.id)) && (
            <div className="pm-status pm-status--error">
              Connect to a supported mainnet network to send this deposit.
            </div>
          )}

          {!quote && (
            <>
              <button
                ref={swipeRef}
                type="button"
                className={`pm-swipe ${status === 'quoting' ? 'pm-swipe--busy' : ''}`}
                aria-label="Swipe to get quote"
                onPointerDown={handleSwipe}
                onClick={() => { if (!swipeOffset) finishSwipe(); }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finishSwipe(); } }}
                disabled={status === 'quoting' || !amount || !SUPPORTED_MAINNET_CHAINS.includes(chain!.id)}
              >
                <span className="pm-swipe__fill" style={{ width: `calc(50px + ${swipeOffset}px)` }} aria-hidden="true" />
                <span className="pm-swipe__thumb" style={{ transform: `translateX(${swipeOffset}px)` }}>
                  <TokenIcon symbol={sourceSymbol} size={38} />
                </span>
                <span className="pm-swipe__label">{status === 'quoting' ? 'Getting quote…' : 'Swipe to continue'}</span>
              </button>
              <div className="pm-swipe__route">{sourceSymbol} on {chainLabel(chain.id)}</div>
            </>
          )}

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
                aria-label="Swipe to confirm deposit"
                onPointerDown={handleSwipe}
                onClick={() => { if (!swipeOffset) finishSwipe(); }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finishSwipe(); } }}
                disabled={isSigning}
              >
                <span className="pm-swipe__fill" style={{ width: `calc(50px + ${swipeOffset}px)` }} aria-hidden="true" />
                <span className="pm-swipe__thumb" style={{ transform: `translateX(${swipeOffset}px)` }}>
                  <TokenIcon symbol={sourceSymbol} size={38} />
                </span>
                <span className="pm-swipe__label">{isSigning ? 'Confirming…' : 'Swipe to confirm'}</span>
              </button>
              <div className="pm-swipe__route">{sourceSymbol} on {chainLabel(chain.id)}</div>
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

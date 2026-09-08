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
  return ({ 1: 'Ethereum', 8453: 'Base', 137: 'Polygon', 43114: 'Avalanche', 42161: 'Arbitrum', 10: 'Optimism', 59144: 'Linea', 143: 'Monad', 11155111: 'Sepolia', 84532: 'Base Sepolia', 80002: 'Polygon Amoy', 56: 'BNB', 324: 'zkSync' } as Record<number, string>)[chainId ?? 0] ?? 'Network';
}

function chainIcon(chainId: number): string {
  return ({ 1: 'Ξ', 8453: 'B', 137: 'P', 11155111: 'Ξ', 84532: 'B', 80002: 'P', 43114: 'A', 42161: 'ARB', 10: 'OP', 59144: 'L', 143: 'M', 56: 'BNB', 324: 'ZK' } as Record<number, string>)[chainId] ?? '◆';
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
  const [carouselIndex, setCarouselIndex] = useState(0);
  const swipeRef = useRef<HTMLButtonElement>(null);

  const connected = isConnected && !!address;
  const isSigning = status === 'signing';
  const supportedChains = config.supportedSourceChains ?? SUPPORTED_MAINNET_CHAINS;
  const activeChainId = chain?.id ?? supportedChains[0] ?? 8453;
  const toTokenSymbol = config.toTokenSymbol ?? 'USDC';
  const [chainSearch, setChainSearch] = useState('');
  const [tokenSearch, setTokenSearch] = useState('');
  const baseSourceToken = config.fromTokenByChain?.[activeChainId] ?? config.fromToken ?? 'native';
  const rawTokenOptions = config.supportedTokensByChain?.[activeChainId]?.filter((token) => Boolean(token?.address)) ?? [];
  const tokenOptions = rawTokenOptions.length > 0
    ? rawTokenOptions
    : [{ symbol: tokenLabel(baseSourceToken), address: baseSourceToken }];
  const [selectedToken, setSelectedToken] = useState<string>();
  const sourceToken = selectedToken ?? tokenOptions[0]?.address ?? baseSourceToken;
  const sourceSymbol = tokenOptions.find((token) => token.address?.toLowerCase() === sourceToken?.toLowerCase())?.symbol ?? tokenLabel(sourceToken);
  const [chainFilter, setChainFilter] = useState<number | null>(null); // null = All Chains
  const chainQ = chainSearch.trim().toLowerCase();
  const tokenQ = tokenSearch.trim().toLowerCase();
  const filteredChains = chainQ
    ? supportedChains.filter((id) => chainLabel(id).toLowerCase().includes(chainQ))
    : supportedChains;
  const tokensForChain = chainFilter !== null
    ? (config.supportedTokensByChain?.[chainFilter]?.filter(t => Boolean(t?.address)) ?? [])
    : tokenOptions;
  const filteredTokens = tokenQ
    ? tokensForChain.filter((token) => token?.symbol?.toLowerCase().includes(tokenQ) || token?.address?.toLowerCase().includes(tokenQ))
    : tokensForChain;

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
      if (!supportedChains.includes(activeChainId)) {
        throw new Error('Connect to a supported network to send this deposit.');
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
        fromChain: activeChainId,
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
  }, [connected, sdk, config, activeChainId, address, amount, resolveTokenDecimals, supportedChains, sourceToken]);

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
        if (txs[i]!.chainId !== undefined && txs[i]!.chainId !== (chain?.id ?? activeChainId)) {
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
    // Capture the DOM node now: React nulls `event.currentTarget` after the
    // handler returns, so the listeners must reference a stable node, not the
    // synthetic event (which caused a "removeEventListener of null" crash).
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const max = Math.max(0, rect.width - 50);
    const startX = event.clientX;
    const startOffset = swipeOffset;
    el.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(0, Math.min(max, startOffset + moveEvent.clientX - startX));
      setSwipeOffset(next);
      if (next >= max * 0.9) finishSwipe();
    };
    const end = () => {
      setSwipeOffset((current) => current >= max * 0.9 ? current : 0);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
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
            {(chain?.name ?? chainLabel(activeChainId))} · {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''}
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
              <div className="pm-result__asset">{amount || '0'} {sourceSymbol} <span>↕</span></div>
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
              <div className="pm-result__received">{formatBaseUnits(quote?.estimatedOutput ?? '0', destDecimals)} {toTokenSymbol}</div>
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

          {/* ── Token Carousel ── */}
          {(() => {
            const rawTokens = config.supportedTokensByChain?.[activeChainId]?.filter(t => Boolean(t?.address)) ?? [];
            const allTokens = rawTokens.length > 0 ? rawTokens : [{ symbol: sourceSymbol, address: sourceToken }];
            const visibleCount = Math.min(allTokens.length, 4);
            const tokenIdx = allTokens.findIndex(t => t.address?.toLowerCase() === sourceToken?.toLowerCase());
            const activeIdx = tokenIdx >= 0 ? tokenIdx : (allTokens.length > 0 ? carouselIndex % allTokens.length : 0);
            // Build a window of up to 4 tokens centred on active
            const startIdx = Math.max(0, Math.min(activeIdx - 1, allTokens.length - visibleCount));
            const visible = allTokens.slice(startIdx, startIdx + visibleCount);
            return (
              <div className="pm-carousel">
                <div className="pm-carousel__track-wrap">
                  <button
                    type="button"
                    className="pm-carousel__arrow"
                    aria-label="Previous token"
                    onClick={() => {
                      const prev = (activeIdx - 1 + allTokens.length) % allTokens.length;
                      setCarouselIndex(prev);
                      setSelectedToken(allTokens[prev]?.address);
                    }}
                  >&#8249;</button>
                  <div className="pm-carousel__icons">
                    {visible.map((t, i) => (
                      <span
                        key={t.address}
                        className={startIdx + i === activeIdx ? 'pm-carousel__icon--active' : ''}
                        style={{ zIndex: startIdx + i === activeIdx ? 3 : 1 }}
                      >
                        <TokenIcon symbol={t.symbol} size={30} />
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="pm-carousel__arrow"
                    aria-label="Next token"
                    onClick={() => {
                      const next = (activeIdx + 1) % allTokens.length;
                      setCarouselIndex(next);
                      setSelectedToken(allTokens[next]?.address);
                    }}
                  >&#8250;</button>
                </div>

                {/* Dots */}
                <div className="pm-carousel__dots" role="tablist">
                  {allTokens.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      role="tab"
                      aria-selected={i === activeIdx}
                      className={`pm-carousel__dot${i === activeIdx ? ' pm-carousel__dot--active' : ''}`}
                      onClick={() => { setCarouselIndex(i); setSelectedToken(allTokens[i]?.address); }}
                    />
                  ))}
                </div>

                {/* Token name + chain + chevron */}
                <div className="pm-carousel__meta">
                  <button type="button" className="pm-carousel__token-label" onClick={() => setSelectorOpen(true)} aria-label="Select chain and token">
                    <strong>{sourceSymbol}</strong>
                    <span>{chainLabel(activeChainId)}</span>
                  </button>
                  <button type="button" className="pm-carousel__chevron" onClick={() => setSelectorOpen(true)} aria-label="Open token selector">&#8964;</button>
                </div>

                {/* Wallet address */}
                <div className="pm-carousel__address">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7"/></svg>
                  {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''}
                </div>
              </div>
            );
          })()}

          {selectorOpen && (
            <div className="pm-selector-backdrop" role="presentation" onClick={() => { setSelectorOpen(false); setChainSearch(''); setTokenSearch(''); setChainFilter(null); }}>
              <section className="pm-selector" role="dialog" aria-modal="true" aria-labelledby="pm-selector-title" onClick={(event) => event.stopPropagation()}>

                {/* Header */}
                <div className="pm-selector__header">
                  <button type="button" className="pm-selector__back" aria-label="Close selector" onClick={() => { setSelectorOpen(false); setChainSearch(''); setTokenSearch(''); setChainFilter(null); }}>‹</button>
                  <h2 id="pm-selector-title">Select Token</h2>
                  <button type="button" className="pm-selector__mode" aria-label="Toggle dark mode">☾</button>
                </div>

                {/* Dual search row */}
                <div className="pm-selector__searches">
                  <div className="pm-selector__search-pill">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input
                      aria-label="Search chain"
                      placeholder="Chain"
                      value={chainSearch}
                      onChange={(e) => setChainSearch(e.target.value)}
                    />
                  </div>
                  <div className="pm-selector__search-pill pm-selector__search-pill--active">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input
                      aria-label="Search token"
                      placeholder="Token"
                      value={tokenSearch}
                      onChange={(e) => setTokenSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className="pm-selector__columns">
                  {/* Left – Chains */}
                  <div className="pm-selector__chains">
                    {/* All Chains pill */}
                    <button
                      type="button"
                      className={`pm-all-chains ${chainFilter === null ? 'pm-all-chains--active' : ''}`}
                      onClick={() => setChainFilter(null)}
                    >
                      <span className="pm-all-chains__icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      </span>
                      All Chains
                    </button>

                    <div className="pm-selector__section-title">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
                      Popular chains
                    </div>

                    {filteredChains.map((chainId) => (
                      <button
                        key={chainId}
                        type="button"
                        className={`pm-chain-option ${chainFilter === chainId ? 'pm-chain-option--active' : ''}`}
                        onClick={() => setChainFilter(chainFilter === chainId ? null : chainId)}
                      >
                        <span className={`pm-chain-option__icon pm-chain-option__icon--${chainId}`}><NetworkIcon chainId={chainId} size={24} /></span>
                        {chainLabel(chainId)}
                      </button>
                    ))}
                    {filteredChains.length === 0 && <div className="pm-selector__empty">No chains match &ldquo;{chainSearch}&rdquo;</div>}
                  </div>

                  {/* Right – Tokens */}
                  <div className="pm-selector__tokens">
                    <div className="pm-selector__section-title">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                      Your tokens
                    </div>

                    {filteredTokens.map((token) => {
                      const displayChainId = chainFilter ?? activeChainId;
                      const isActive = Boolean(token?.address && sourceToken && token.address.toLowerCase() === sourceToken.toLowerCase());
                      return (
                        <button
                          key={`${displayChainId}-${token.address}`}
                          type="button"
                          className={`pm-token-option ${isActive ? 'pm-token-option--active' : ''}`}
                          onClick={async () => {
                            const targetChainId = chainFilter ?? activeChainId;
                            const targetTokenAddress = token.address;
                            setSelectedToken(targetTokenAddress);
                            setSelectorOpen(false);
                            setChainSearch('');
                            setTokenSearch('');
                            setChainFilter(null);

                            if (targetChainId && chain?.id && targetChainId !== chain.id && switchChain) {
                              try {
                                await switchChain({ chainId: targetChainId });
                              } catch (err) {
                                console.warn('Network switch rejected or not supported:', err);
                              }
                            }
                          }}
                        >
                          {/* Stacked icon: token + chain badge */}
                          <span className="pm-token-option__icon-wrap">
                            <span className={`pm-token-option__icon pm-token-option__icon--${token.symbol.toLowerCase()}`}>
                              <TokenIcon symbol={token.symbol} size={32} />
                            </span>
                            <span className="pm-token-option__chain-badge">
                              <NetworkIcon chainId={displayChainId} size={14} />
                            </span>
                          </span>
                          <span className="pm-token-option__info">
                            <strong>{token.symbol}</strong>
                            <small>{chainLabel(displayChainId)}</small>
                          </span>
                        </button>
                      );
                    })}
                    {filteredTokens.length === 0 && <div className="pm-selector__empty">No tokens match &ldquo;{tokenSearch || chainSearch}&rdquo;</div>}
                  </div>
                </div>
              </section>
            </div>
          )}

          <div className="pm-range-wrap">
            <div className="pm-range-header"><span>$0</span><span>Max</span></div>
            <input
              className="pm-range pm-range-track-fill"
              type="range"
              min="0"
              max="150"
              step="0.01"
              value={Math.min(150, Number(amount) || 0)}
              aria-label="Amount slider"
              style={{'--fill-pct': `${(Math.min(150, Number(amount) || 0) / 150) * 100}%`} as React.CSSProperties}
              onChange={(e) => resetQuote(e.target.value)}
            />
            <div className="pm-range-labels"><span>$0</span><span>$50</span><span>$100</span><span>$150</span></div>
          </div>

          {(!supportedChains.includes(activeChainId)) && (
            <div className="pm-status pm-status--error">
              Connect to a supported network to send this deposit.
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
                disabled={status === 'quoting' || !amount || !supportedChains.includes(activeChainId)}
              >
                <span className="pm-swipe__fill" style={{ width: `calc(50px + ${swipeOffset}px)` }} aria-hidden="true" />
                <span className="pm-swipe__thumb" style={{ transform: `translateX(${swipeOffset}px)` }}>
                  <TokenIcon symbol={sourceSymbol} size={38} />
                </span>
                <span className="pm-swipe__label">{status === 'quoting' ? 'Getting quote…' : 'Swipe to continue'}</span>
                <span className="pm-swipe__destination" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </span>
              </button>
              <div className="pm-swipe__route">{sourceSymbol} on {chainLabel(activeChainId)} → {config.toTokenSymbol ?? 'USDC'}</div>
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
                <span className="pm-swipe__destination" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </span>
              </button>
              <div className="pm-swipe__route">{sourceSymbol} on {chainLabel(activeChainId)} → {config.toTokenSymbol ?? 'USDC'}</div>
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

import { useMemo, useState, useCallback } from 'react';
import { useAccount, useConnect, useSwitchChain, useWalletClient } from 'wagmi';
import { PayMeshClient, type QuoteResult } from '@paymesh/sdk';
import type { PayMeshDepositApi, PayMeshDepositConfig, DepositStatus } from './types';

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

function hopTransaction(quote: QuoteResult): { to: string; data: string; value: string } {
  const first = quote.hopTransactionRequests?.[0];
  if (first) return first;
  return {
    to: quote.transactionRequest?.to ?? '0x0000000000000000000000000000000000000000',
    data: quote.transactionRequest?.data ?? '0x',
    value: quote.transactionRequest?.value ?? '0',
  };
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

  const sdk = useMemo<PayMeshDepositApi>(
    () => new PayMeshClient({ baseUrl: config.apiUrl, apiKey: config.apiKey }),
    [config.apiUrl, config.apiKey],
  );

  const [amount, setAmount] = useState('');
  const [depositId, setDepositId] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [status, setStatus] = useState<DepositStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const connected = isConnected && !!address && !!chain;
  const isSigning = status === 'signing';

  const startDeposit = useCallback(async () => {
    if (!connected) return;
    setStatus('quoting');
    setError(null);
    try {
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
        fromAmount: amount,
        fromAddress: address,
        slippageBps: config.defaultSlippageBps,
      });
      setQuote(result);
      setStatus('ready');
    } catch (e) {
      setStatus('failed');
      setError(messageOf(e));
    }
  }, [connected, sdk, config, chain, address, amount]);

  const confirm = useCallback(async () => {
    if (!walletClient || !quote || !depositId) return;
    setStatus('signing');
    setError(null);
    try {
      const hash = await sdk.signAndSend(walletClient, hopTransaction(quote));
      await sdk.reportTransaction(quote.quoteId, 0, hash);
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

          {chain!.id !== config.toChain && (
            <button
              type="button"
              className="pm-btn pm-btn--ghost"
              onClick={() => switchChain({ chainId: config.toChain })}
            >
              Switch to destination chain
            </button>
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
                <strong>{quote.estimatedOutput}</strong>
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
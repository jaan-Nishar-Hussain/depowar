import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PayMeshDeposit } from '../src';

const connect = vi.fn();
const switchChain = vi.fn();
let accountState: {
  address?: string;
  isConnected: boolean;
  chain?: { id: number; name: string };
};
const walletClient = { sendTransaction: vi.fn() };
const readContract = vi.fn().mockResolvedValue(18);

vi.mock('wagmi', () => ({
  useAccount: () => accountState,
  useConnect: () => ({ connect, connectors: [{ id: 'injected', name: 'Injected' }] }),
  useSwitchChain: () => ({ switchChain }),
  useWalletClient: () => ({ data: walletClient }),
  usePublicClient: () => ({ readContract }),
}));

const mocks = {
  createDepositIntent: vi.fn(),
  getQuote: vi.fn(),
  signAndSend: vi.fn(),
  reportTransaction: vi.fn(),
  getStatus: vi.fn(),
  pollUntilSettled: vi.fn(),
};

vi.mock('@paymesh/sdk', () => ({
  PayMeshClient: class {
    createDepositIntent = mocks.createDepositIntent;
    getQuote = mocks.getQuote;
    signAndSend = mocks.signAndSend;
    reportTransaction = mocks.reportTransaction;
    getStatus = mocks.getStatus;
    pollUntilSettled = mocks.pollUntilSettled;
  },
}));

const config = {
  apiUrl: 'http://localhost:4000',
  apiKey: 'pm_test',
  recipientId: 'rec_1',
  toChain: 84532,
  toToken: 'USDC',
  fromToken: 'native',
};

beforeEach(() => {
  accountState = { address: undefined, isConnected: false, chain: undefined };
  vi.clearAllMocks();
  mocks.createDepositIntent.mockResolvedValue({ depositId: 'dep_1' });
  mocks.getQuote.mockResolvedValue({
    quoteId: 'qt_1',
    route: [{ type: 'bridge' }],
    estimatedOutput: '1980000',
    estimatedTimeSeconds: 95,
    hopTransactionRequests: [{ to: '0x2222222222222222222222222222222222222222', data: '0xdeadbeef', value: '0' }],
  });
  mocks.signAndSend.mockResolvedValue('0xhash');
  mocks.reportTransaction.mockResolvedValue({});
  mocks.pollUntilSettled.mockResolvedValue({ status: 'SETTLED' });
});

describe('PayMeshDeposit', () => {
  it('shows a connect button when no wallet is connected', () => {
    render(<PayMeshDeposit config={config} />);
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeInTheDocument();
  });

  it('connects the wallet on click', () => {
    render(<PayMeshDeposit config={config} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('quotes, signs, and reports a deposit to settlement', async () => {
    accountState = { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', isConnected: true, chain: { id: 11155111, name: 'Sepolia' } };
    render(<PayMeshDeposit config={config} />);

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deposit' }));

    await waitFor(() => expect(mocks.createDepositIntent).toHaveBeenCalledTimes(1));
    expect(mocks.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        fromChain: 11155111,
        fromAmount: '10000000000000000', // 0.01 ETH -> wei
        fromToken: 'native',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mocks.signAndSend).toHaveBeenCalledTimes(1));
    expect(mocks.reportTransaction).toHaveBeenCalledWith('qt_1', 0, '0xhash');
    await waitFor(() => expect(screen.getByText('Deposit Completed')).toBeInTheDocument());
  });

  it('surfaces API errors as user-facing messages', async () => {
    accountState = { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', isConnected: true, chain: { id: 11155111, name: 'Sepolia' } };
    mocks.getQuote.mockRejectedValue(new Error('No route is available for that combination of chain and asset.'));

    render(<PayMeshDeposit config={config} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deposit' }));

    await waitFor(() => expect(screen.getByText('No route is available for that combination of chain and asset.')).toBeInTheDocument());
  });

  it('signs every hop of a multi-step route before settling', async () => {
    accountState = { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', isConnected: true, chain: { id: 11155111, name: 'Sepolia' } };
    mocks.getQuote.mockResolvedValue({
      quoteId: 'qt_2',
      route: [{ type: 'swap' }, { type: 'transfer' }],
      estimatedOutput: '1980000',
      estimatedTimeSeconds: 95,
      hopTransactionRequests: [
        { to: '0x2222222222222222222222222222222222222222', data: '0xaaa', value: '0' },
        { to: '0x3333333333333333333333333333333333333333', data: '0xbbb', value: '0' },
      ],
    });
    mocks.getStatus.mockResolvedValue({ status: 'AWAITING_SIGNATURE' });

    render(<PayMeshDeposit config={config} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deposit' }));
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mocks.signAndSend).toHaveBeenCalledTimes(2);
      expect(mocks.reportTransaction).toHaveBeenNthCalledWith(1, 'qt_2', 0, expect.any(String));
      expect(mocks.reportTransaction).toHaveBeenNthCalledWith(2, 'qt_2', 1, expect.any(String));
    });
    await waitFor(() => expect(screen.getByText('Deposit Completed')).toBeInTheDocument());
  });
});
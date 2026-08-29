import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseEther,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readArtifact } from './artifacts';

export const ANVIL_DEFAULT_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
export const ANVIL_DEFAULT_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

export interface TestDeployment {
  chainId: number;
  rpcUrl: string;
  deployer: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
  depositReceiver: Address;
  mockUsdc: Address;
  mockWeth: Address;
  mockDex: Address;
  mockBridge: Address;
}

export interface DeployOptions {
  rpcUrl?: string;
  chainId?: number;
  privateKey?: Hex;
  seedLiquidity?: boolean;
}

/**
 * Deploys the full PayMesh mock stack to a running chain (Anvil locally,
 * testnets when RPC + key are provided). Seeds DEX liquidity, a relayer, and
 * destination-side bridge liquidity so settlement tests work out of the box.
 */
export async function deployTestSuite(options: DeployOptions = {}): Promise<TestDeployment> {
  const rpcUrl = options.rpcUrl ?? process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
  const chainId = options.chainId ?? Number(process.env.ANVIL_CHAIN_ID ?? 31337);
  const privateKey =
    (options.privateKey ?? process.env.ANVIL_ACCOUNT_PRIVATE_KEY ?? ANVIL_DEFAULT_PRIVATE_KEY) as Hex;
  const account = privateKeyToAccount(privateKey);

  const chain: Chain = {
    id: chainId,
    name: `Anvil-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });

  const deploy = async (contract: string, args: readonly unknown[] = []): Promise<Address> => {
    const artifact = readArtifact(contract);
    const hash = await walletClient.deployContract({
      abi: artifact.abi,
      args: args as readonly unknown[],
      bytecode: artifact.bytecode,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Deploy of ${contract} produced no address`);
    return receipt.contractAddress;
  };

  const depositReceiver = await deploy('DepositReceiver', [account.address]);
  const mockUsdc = await deploy('MockERC20', ['Mock USDC', 'USDC', 6]);
  const mockWeth = await deploy('MockERC20', ['Mock WETH', 'WETH', 18]);
  const mockDex = await deploy('MockDEX');
  const mockBridge = await deploy('MockBridge', [account.address]);

  const write = async (
    to: Address,
    abi: ReturnType<typeof readArtifact>['abi'],
    functionName: string,
    args: readonly unknown[],
  ) => {
    const hash = await walletClient.writeContract({
      address: to,
      abi,
      functionName,
      args: args as readonly unknown[],
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  };

  if (options.seedLiquidity ?? true) {
    const erc20Abi = readArtifact('MockERC20').abi;
    const dexAbi = readArtifact('MockDEX').abi;
    const bridgeAbi = readArtifact('MockBridge').abi;

    await write(mockUsdc, erc20Abi, 'mint', [account.address, parseEther('2000000')]);
    await write(mockWeth, erc20Abi, 'mint', [account.address, parseEther('2000')]);

    await write(mockUsdc, erc20Abi, 'approve', [mockDex, maxUint256]);
    await write(mockWeth, erc20Abi, 'approve', [mockDex, maxUint256]);
    await write(mockDex, dexAbi, 'addLiquidity', [
      mockUsdc,
      mockWeth,
      parseEther('1000000'),
      parseEther('1000'),
    ]);

    await write(mockBridge, bridgeAbi, 'setRelayer', [account.address]);
    await write(mockUsdc, erc20Abi, 'mint', [mockBridge, parseEther('1000000')]);
  }

  return {
    chainId,
    rpcUrl,
    deployer: account.address,
    publicClient,
    walletClient,
    depositReceiver,
    mockUsdc,
    mockWeth,
    mockDex,
    mockBridge,
  };
}
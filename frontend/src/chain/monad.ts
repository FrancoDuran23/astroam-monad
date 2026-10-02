import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  getAddress,
  http,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem'
import type { MonadClosePlan, MonadDepositPlan } from '../types/mission'

export const MONAD_USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3' as const
export const MONAD_EXPLORER = 'https://testnet.monadvision.com'

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: MONAD_EXPLORER } },
})

const escrowAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'topUp',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'close',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'cumulativeAmount', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'escrowId', type: 'bytes32' }],
    outputs: [],
  },
] as const

type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  isMetaMask?: boolean
  isRabby?: boolean
  isPhantom?: boolean
}

declare global {
  interface Window {
    ethereum?: InjectedProvider
  }
}

export function monadTxUrl(txHash: string): string {
  return `${MONAD_EXPLORER}/tx/${txHash}`
}

export function walletError(error: unknown): string {
  if (error && typeof error === 'object' && 'shortMessage' in error && typeof (error as { shortMessage: unknown }).shortMessage === 'string') {
    return (error as { shortMessage: string }).shortMessage
  }
  return error instanceof Error ? error.message : String(error)
}

function injectedProvider(): InjectedProvider {
  const eth = window.ethereum
  if (!eth?.request) {
    throw new Error('No hay una wallet inyectada. Instalá MetaMask o Rabby.')
  }
  if (eth.isPhantom && !eth.isMetaMask && !eth.isRabby) {
    throw new Error('Esta demo usa MetaMask o Rabby. Phantom no firma el depósito.')
  }
  return eth
}

const ADD_CHAIN = {
  chainId: '0x279f',
  chainName: 'Monad Testnet',
  rpcUrls: ['https://testnet-rpc.monad.xyz'],
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  blockExplorerUrls: [MONAD_EXPLORER],
}

async function connectedWallet(): Promise<{ client: WalletClient; account: Address }> {
  const eth = injectedProvider()
  const client = createWalletClient({ chain: monadTestnet, transport: custom(eth) })
  await client.request({ method: 'wallet_addEthereumChain', params: [ADD_CHAIN] })
  await client.switchChain({ id: monadTestnet.id })
  const [account] = await client.requestAddresses()
  if (!account) throw new Error('La wallet no devolvió una cuenta.')
  return { client, account: getAddress(account) }
}

function publicClient() {
  return createPublicClient({ chain: monadTestnet, transport: http(monadTestnet.rpcUrls.default.http[0]) })
}

export async function connectMonadWallet(): Promise<Address> {
  const { account } = await connectedWallet()
  return account
}

async function approveAndCall(params: {
  escrow: Address
  amount: bigint
  write: (client: WalletClient, account: Address) => Promise<Hex>
}): Promise<{ hash: Hex; traveler: Address }> {
  const { client, account } = await connectedWallet()
  const approveHash = await client.writeContract({
    account,
    chain: monadTestnet,
    address: MONAD_USDC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [params.escrow, params.amount],
  })
  await publicClient().waitForTransactionReceipt({ hash: approveHash })
  const hash = await params.write(client, account)
  await publicClient().waitForTransactionReceipt({ hash })
  return { hash, traveler: account }
}

export async function depositUsdc(plan: MonadDepositPlan): Promise<{ hash: Hex; traveler: Address }> {
  if (!plan.escrow) {
    throw new Error('El escrow no está desplegado. Corré npm run monad:deploy y configurá MONAD_ESCROW_ADDRESS.')
  }
  const escrow = plan.escrow
  const amount = BigInt(plan.amount)
  return approveAndCall({
    escrow,
    amount,
    write: (client, account) =>
      client.writeContract({
        account,
        chain: monadTestnet,
        address: escrow,
        abi: escrowAbi,
        functionName: 'deposit',
        args: [plan.escrowId, amount],
      }),
  })
}

export async function topUpUsdc(plan: MonadDepositPlan): Promise<{ hash: Hex; traveler: Address }> {
  if (!plan.escrow) {
    throw new Error('El escrow no está desplegado. Corré npm run monad:deploy y configurá MONAD_ESCROW_ADDRESS.')
  }
  const escrow = plan.escrow
  const amount = BigInt(plan.amount)
  return approveAndCall({
    escrow,
    amount,
    write: (client, account) =>
      client.writeContract({
        account,
        chain: monadTestnet,
        address: escrow,
        abi: escrowAbi,
        functionName: 'topUp',
        args: [plan.escrowId, amount],
      }),
  })
}

export async function closeEscrow(plan: MonadClosePlan): Promise<Hex> {
  if (!plan.escrow || !plan.typedData) {
    throw new Error('El escrow no está desplegado. Corré npm run monad:deploy y configurá MONAD_ESCROW_ADDRESS.')
  }
  const escrow = plan.escrow
  const { client, account } = await connectedWallet()
  const cumulativeAmount = BigInt(plan.typedData.message.cumulativeAmount)
  const signature = await client.signTypedData({
    account,
    domain: {
      name: plan.typedData.domain.name,
      version: plan.typedData.domain.version,
      chainId: plan.typedData.domain.chainId,
      verifyingContract: plan.typedData.domain.verifyingContract,
    },
    types: {
      CloseVoucher: [
        { name: 'escrowId', type: 'bytes32' },
        { name: 'cumulativeAmount', type: 'uint256' },
      ],
    },
    primaryType: 'CloseVoucher',
    message: {
      escrowId: plan.typedData.message.escrowId,
      cumulativeAmount,
    },
  })
  const hash = await client.writeContract({
    account,
    chain: monadTestnet,
    address: escrow,
    abi: escrowAbi,
    functionName: 'close',
    args: [plan.escrowId, cumulativeAmount, signature],
  })
  await publicClient().waitForTransactionReceipt({ hash })
  return hash
}

export async function refundEscrow(escrow: Address, escrowId: Hex): Promise<Hex> {
  const { client, account } = await connectedWallet()
  const hash = await client.writeContract({
    account,
    chain: monadTestnet,
    address: escrow,
    abi: escrowAbi,
    functionName: 'refund',
    args: [escrowId],
  })
  await publicClient().waitForTransactionReceipt({ hash })
  return hash
}

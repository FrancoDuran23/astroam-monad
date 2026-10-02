// Monad wallet flow for PAYMENT_RAIL=monad.
//
// 1. Deposit: the traveler's wallet (MetaMask, Rabby…) approves USDC and calls
//    `deposit(escrowId, amount, sessionSigner)` on AstroAmEscrow. The session
//    signer is a key this app generates and keeps in the browser.
// 2. Authorize: while the trip runs, the app signs EIP-712 vouchers with that
//    session key for the running total it lets AstroAm charge, a little ahead
//    of usage. No wallet popup per MB, nothing on-chain per MB.
// 3. Close: AstroAm settles what was actually used (never more than the last
//    voucher) in one transaction and the rest goes back to the wallet.

import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { EvmDepositPlan } from '../types/mission'

const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

const escrowAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'signer', type: 'address' },
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
] as const

const VOUCHER_TYPES = {
  Voucher: [
    { name: 'escrowId', type: 'bytes32' },
    { name: 'cumulativeAmount', type: 'uint256' },
  ],
} as const

type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: InjectedProvider
  }
}

export function walletError(error: unknown): string {
  if (error && typeof error === 'object' && 'shortMessage' in error && typeof error.shortMessage === 'string') {
    return error.shortMessage
  }
  return error instanceof Error ? error.message : String(error)
}

function chainOf(plan: EvmDepositPlan) {
  return defineChain({
    id: plan.chainId,
    name: plan.chainName,
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [plan.rpcUrl] } },
    blockExplorers: { default: { name: 'Explorer', url: plan.explorer } },
  })
}

async function connect(plan: EvmDepositPlan) {
  const eth = window.ethereum
  if (!eth?.request) throw new Error('No browser wallet found. Install MetaMask or Rabby to pay with USDC on Monad.')
  const chain = chainOf(plan)
  const wallet = createWalletClient({ chain, transport: custom(eth) })
  const [account] = await wallet.requestAddresses()
  if (!account) throw new Error('The wallet did not return an account.')
  try {
    await wallet.switchChain({ id: chain.id })
  } catch {
    await wallet.addChain({ chain })
    await wallet.switchChain({ id: chain.id })
  }
  const reader = createPublicClient({ chain, transport: http(plan.rpcUrl) })
  return { wallet, reader, chain, account: getAddress(account) }
}

// ── Session key, one per mission ─────────────────────────────────────────────

type SessionRecord = {
  privateKey: Hex
  escrowId: Hex
  contract: Address
  chainId: number
  tokenDecimals: number
  /** Highest cumulative amount signed so far, in token units. */
  authorizedAtomic: string
}

const sessionStorageKey = (missionId: string) => `astroam_session_${missionId}`

function loadSession(missionId: string): SessionRecord | null {
  try {
    const raw = localStorage.getItem(sessionStorageKey(missionId))
    return raw ? (JSON.parse(raw) as SessionRecord) : null
  } catch {
    return null
  }
}

function saveSession(missionId: string, record: SessionRecord): void {
  localStorage.setItem(sessionStorageKey(missionId), JSON.stringify(record))
}

export function hasSessionKey(missionId: string): boolean {
  return loadSession(missionId) !== null
}

function sessionFor(missionId: string, plan: EvmDepositPlan): SessionRecord {
  const existing = loadSession(missionId)
  if (existing && existing.escrowId === plan.escrowId) return existing
  const record: SessionRecord = {
    privateKey: generatePrivateKey(),
    escrowId: plan.escrowId as Hex,
    contract: getAddress(plan.contract),
    chainId: plan.chainId,
    tokenDecimals: plan.tokenDecimals,
    authorizedAtomic: '0',
  }
  saveSession(missionId, record)
  return record
}

// ── Deposit / top-up ─────────────────────────────────────────────────────────

export type DepositProgress = 'connecting' | 'approving' | 'depositing' | 'confirming'

/**
 * Sends the deposit (or top-up) from the traveler's wallet: approve if the
 * allowance is short, then deposit/topUp. Returns the escrow transaction hash.
 */
export async function sendDeposit(
  missionId: string,
  plan: EvmDepositPlan,
  onProgress?: (step: DepositProgress) => void,
): Promise<Hex> {
  onProgress?.('connecting')
  const { wallet, reader, chain, account } = await connect(plan)
  const token = getAddress(plan.token)
  const contract = getAddress(plan.contract)
  const amount = BigInt(plan.amountAtomic)

  const balance = await reader.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
  if (balance < amount) {
    const have = Number(balance) / 10 ** plan.tokenDecimals
    throw new Error(`This wallet has ${have} USDC on ${plan.chainName}; the deposit needs ${Number(amount) / 10 ** plan.tokenDecimals}. Get test USDC at faucet.circle.com.`)
  }

  const allowance = await reader.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account, contract] })
  if (allowance < amount) {
    onProgress?.('approving')
    const approveHash = await wallet.writeContract({ account, chain, address: token, abi: erc20Abi, functionName: 'approve', args: [contract, amount] })
    await reader.waitForTransactionReceipt({ hash: approveHash })
  }

  onProgress?.('depositing')
  const escrowId = plan.escrowId as Hex
  const hash =
    plan.method === 'deposit'
      ? await wallet.writeContract({
          account,
          chain,
          address: contract,
          abi: escrowAbi,
          functionName: 'deposit',
          args: [escrowId, amount, privateKeyToAccount(sessionFor(missionId, plan).privateKey).address],
        })
      : await wallet.writeContract({ account, chain, address: contract, abi: escrowAbi, functionName: 'topUp', args: [escrowId, amount] })

  onProgress?.('confirming')
  const receipt = await reader.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('The deposit transaction reverted.')
  return hash
}

// ── Usage authorization ──────────────────────────────────────────────────────

/**
 * Signs a voucher for `cumulativeUsdc` (rounded up to the token's decimals)
 * with the mission's session key. Returns null when it would not raise what
 * is already authorized.
 */
export async function signAuthorization(
  missionId: string,
  cumulativeUsdc: number,
): Promise<{ cumulativeAmount: string; signature: Hex } | null> {
  const session = loadSession(missionId)
  if (!session) throw new Error('This browser does not hold the session key for this trip.')
  const atomic = BigInt(Math.ceil(cumulativeUsdc * 10 ** session.tokenDecimals - 1e-9))
  if (atomic <= BigInt(session.authorizedAtomic)) return null
  const signature = await privateKeyToAccount(session.privateKey).signTypedData({
    domain: { name: 'AstroAmEscrow', version: '1', chainId: session.chainId, verifyingContract: session.contract },
    types: VOUCHER_TYPES,
    primaryType: 'Voucher',
    message: { escrowId: session.escrowId, cumulativeAmount: atomic },
  })
  return { cumulativeAmount: atomic.toString(), signature }
}

/** Records a voucher the server accepted, so the next one only goes up. */
export function recordAuthorization(missionId: string, cumulativeAmount: string): void {
  const session = loadSession(missionId)
  if (!session) return
  if (BigInt(cumulativeAmount) > BigInt(session.authorizedAtomic)) {
    saveSession(missionId, { ...session, authorizedAtomic: cumulativeAmount })
  }
}

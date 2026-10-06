export type DestinationInfo = {
  id: string
  name: string
  flag: string
  network: string
  coverage: string
  pricePerMbUsdc: number
}

export type ProductMissionStatus =
  | 'pending_payment'
  | 'paid'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type TopUpRecord = {
  id: string
  intentId: string
  amountUsdc: number
  txHash?: string
  explorerUrl?: string
  status: 'pending' | 'settled'
  createdAt: string
}

export type PublicEsimInfo = {
  iccid: string
  lpaString: string
  qrCode: string
  directInstallUrl: string
  status: string
  isMock?: boolean
}

export type StoredVoucher = {
  cumulativeAtomic: string
  signature: string
  signedAt: string
}

export type ClaimRecord = {
  amountAtomic?: string
  cumulativeAtomic: string
  txHash: string
  claimedAt?: string
  at?: string
  explorerUrl?: string
}

export type ProductMission = {
  id: string
  userId: string
  destination: DestinationInfo
  startDate: string
  endDate: string
  durationDays: number
  budgetUsdc: number
  dailyLimitUsdc: number
  autoPause: boolean
  lowBalanceAlert: boolean
  status: ProductMissionStatus
  paymentStatus: 'pending' | 'paid' | 'failed'
  paymentIntentId?: string
  depositTxHash?: string
  depositExplorerUrl?: string
  /** sha256("astroam-escrow:" + mission id) / channel identifier */
  escrowId?: string
  /** Deposit in 6-decimal USDC atomic units. */
  depositAtomic?: string
  /** Traveler wallet that signed the deposit. */
  travelerAddress?: string
  /** Session key the deposit registered in the escrow. It signs EIP-712 vouchers. */
  sessionKey?: string
  /** true once the backend verified this deposit on-chain. */
  depositVerified?: boolean
  /** Deposit, last top-up or last claim, ISO. The escrow's refund timeout runs from here. */
  escrowActiveAt?: string
  voucher?: StoredVoucher
  /** Collected so far by `claim`, in 6-decimal USDC atomic units. */
  claimedAtomic?: string
  claims?: ClaimRecord[]
  /** USD cents funded into the eSIM wallet this trip. Never more than one tranche ahead of the voucher. */
  fundedCents?: number
  /** A fund sent to the provider and not confirmed yet. */
  pendingFund?: { amountCents: number; requestedAt: string }
  /** Provider's lifetime charged figure when the trip started, micro-USD. */
  chargedBaselineMicroUsd?: string
  /** Last time metered usage grew, ISO. */
  lastUsageAt?: string
  /** Why the backend closed the trip by itself. */
  autoCloseReason?: 'deposit_spent' | 'trip_ended' | 'timeout_near' | 'idle'
  /** Payment channel opened by the deposit (format depends on the rail). */
  channelId?: string
  iccid?: string
  esim?: PublicEsimInfo
  esimStatus: 'active' | 'paused' | 'disabled' | 'not_provisioned'
  meteredBytes: string // string representation of bigint
  carrierBytes: string // string representation of bigint
  balanceUsdc: number
  consumedUsdc: number
  consumedMb: number
  topups: TopUpRecord[]
  closeTxHash?: string
  closeExplorerUrl?: string
  settlement?: 'close' | 'timeout_refund'
  /** Settled to AstroAm when the channel closed, in USDC. */
  settledUsdc?: number
  /** Returned to the traveler when the channel closed, in USDC. */
  refundedUsdc?: number
  createdAt: string
  updatedAt: string
}

export type Capabilities = {
  backendAvailable: boolean
  /** `<chain>:<name>` of the payment rail, e.g. "monad:testnet". */
  network: string
  /** Human name of the payment rail, e.g. "Monad testnet". */
  paymentRail: string
  /** false while payments are simulated (FakeRail). */
  paymentsLive: boolean
  /** "traveler": the app signs vouchers with a session key (Monad). */
  voucherSigning: 'rail' | 'traveler'
  channelReady: boolean
  citrusReady: boolean
  connectivityProvider: 'fake' | 'citrus'
  citrusStatus: 'live' | 'unavailable'
  meteringMode: 'real' | 'demo' | 'unavailable'
  reconciliationAvailable: boolean
  demoTrafficEnabled: boolean
  mode: 'live' | 'partial' | 'demo'
  liveEnabled: boolean
  requiresAuth: boolean
  missingConfiguration: string[]
}

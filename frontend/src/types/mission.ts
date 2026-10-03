// ── Core domain types for the AstroAm mission flow ──────────────────────────────

/** `<chain>:<name>` of the payment rail, e.g. "monad:testnet" or "demo:local". */
export type Network = string

export type MissionStatus =
  | 'pending_payment'
  | 'paid'
  | 'active'
  | 'paused'
  | 'closing'
  | 'refund_pending'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'error'

export type Destination = {
  id: string
  name: string
  flag: string
  network: string
  coverage: string
  pricePerMbUsdc: number
}

export type PublicEsimInfo = {
  iccid: string
  lpaString: string
  qrCode: string
  directInstallUrl: string
  status: string
  isMock?: boolean
}

export type Mission = {
  id: string
  origin: string
  destination: Destination
  startDate: string        // ISO date string (YYYY-MM-DD)
  endDate: string          // ISO date string (YYYY-MM-DD)
  durationDays: number
  budgetUsdc: number       // initial deposit
  dailyLimitUsdc: number
  alertAt20pct: boolean
  autoPauseAtLimit: boolean
  status: MissionStatus
  paymentStatus?: 'pending' | 'paid' | 'failed'
  depositTxHash?: string
  depositExplorerUrl?: string
  // live state
  balanceUsdc: number      // remaining
  consumedUsdc: number
  consumedMb: number
  esimStatus: 'active' | 'paused' | 'disabled' | 'not_provisioned'
  network: Network
  channelId: string        // payment channel opened by the deposit
  iccid?: string
  esim?: PublicEsimInfo
  isMock?: boolean
  closeTxHash?: string
  closeExplorerUrl?: string
  settledUsdc?: number
  refundedUsdc?: number
  createdAt: string        // ISO timestamp
}

export type UsageEvent = {
  id: string
  timestamp: string        // ISO timestamp
  kind: 'usage' | 'topup'
  mb: number
  amountUsdc: number
  /** signed: a voucher covers it; rejected: the channel could not pay. */
  status: 'signed' | 'rejected' | 'settled'
  /** Voucher signature or transaction id, shortened in the UI. */
  txId: string
  explorerUrl?: string
}

export type PaymentEvent = {
  id: string
  timestamp: string
  type: 'topup' | 'micropayment' | 'refund'
  amountUsdc: number
  description: string
}

export type MissionState = {
  mission: Mission | null
  events: UsageEvent[]
}

/** What the traveler's EVM wallet sends for a deposit (PAYMENT_RAIL=monad). */
export type EvmDepositPlan = {
  kind: 'evm'
  chainId: number
  chainName: string
  rpcUrl: string
  explorer: string
  token: string
  tokenDecimals: number
  contract: string
  escrowId: string
  amountAtomic: string
  method: 'deposit' | 'topUp'
}

export type PaymentIntentInfo = {
  intentId: string
  amount: string
  asset: string
  /** Address the deposit goes to (the payment channel contract). */
  payTo?: string
  /** Wallet deep link for the deposit. */
  paymentUri?: string
  qr?: string
  network?: string
  status: string
  isMock: boolean
  /** Present when the wallet sends the deposit itself (Monad). */
  evm?: EvmDepositPlan
}

export type PaymentConfirmationResult = {
  valid: boolean
  status: string
  depositTxHash?: string
  explorerUrl?: string
  channelId?: string
}

export type FinishResult = {
  txHash?: string
  explorerUrl?: string
  status: 'closing' | 'refund_pending' | 'settling' | 'completed' | 'failed'
  closeKind?: string
  settledUsdc?: number
  refundedUsdc?: number
  /** @deprecated kept for the offline demo; use refundedUsdc. */
  refundAmountUsdc?: number
}

export type CancelResult = {
  status: 'cancelled'
  txHash?: string
  explorerUrl?: string
  refundedUsdc?: number
}

export type BackendCapabilities = {
  backendAvailable: boolean
  network: string
  paymentRail: string
  paymentsLive: boolean
  /** "traveler": the app signs usage vouchers with its session key. */
  voucherSigning?: 'rail' | 'traveler'
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

// ── Wizard step state ────────────────────────────────────────────────────────

export type WizardStep = 1 | 2 | 3 | 4

export type WizardData = {
  destination: Destination | null
  startDate: string
  endDate: string
  budgetUsdc: number
  dailyLimitUsdc: number
  alertAt20pct: boolean
  autoPauseAtLimit: boolean
}

// ── Activation step type ─────────────────────────────────────────────────────

export type ActivationStep = {
  label: string
  status: 'pending' | 'running' | 'done'
}

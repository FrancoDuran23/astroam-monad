import type { ConnectivityProvider } from '../../providers/connectivity/ConnectivityProvider.ts'
import type { MissionRepository } from '../persistence/MissionRepository.ts'
import { MemoryMissionLog, type MissionLog, type MissionLogEntry, type MissionLogType } from '../persistence/MissionLog.ts'
import type { Capabilities, ClaimRecord, DestinationInfo, ProductMission, PublicEsimInfo, TopUpRecord } from '../types/mission.ts'
import { IntegratedMeterService } from '../../meter/meter-service.ts'
import { computeCostRaw, type ChannelBalancePort } from '../../services/PolicyEnforcer.ts'
import { createConnectivitySession, type ConnectivitySession } from '../../models/ConnectivitySession.ts'
import { runReconciliation } from '../../jobs/reconciliation.ts'
import { parseNonNegativeIntegerRaw, pricePerMibFromPerMbRaw } from '../../shared/money.ts'
import type { PaymentRail } from '../../rails/PaymentRail.ts'
import { assertSufficientResellerBalance } from '../../services/reseller-balance-guard.ts'
import { createChannelMutex } from '../../shared/mutex.ts'
import { equivalentBytes } from '../../shared/usage-math.ts'
import { atomicToRaw, rawToAtomicCeil, rawToAtomicFloor, formatAtomic } from '../../shared/monad/amounts.ts'
import {
  claimableAtomic,
  claimIsDue,
  nextFundCents,
  autoCloseReason,
  type FundFlowConfig,
  type AutoCloseReason,
  DEFAULT_FUND_FLOW,
} from './fund-flow.ts'
import { isWildcardOrigin } from '../api/cors.ts'

const FUND_TOLERANCE_CENTS = 1
const MICRO_USD_PER_CENT = 10_000n

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The usage figures every usage entry of the log carries. */
function usageData(mission: ProductMission, extra: MissionLogEntry['data']): MissionLogEntry['data'] {
  return {
    ...extra,
    meteredBytes: mission.meteredBytes,
    consumedMb: mission.consumedMb,
    consumedUsdc: mission.consumedUsdc,
    balanceUsdc: mission.balanceUsdc,
  }
}

function applyMeteredBytes(mission: ProductMission, totalBytes: bigint): void {
  if (totalBytes > BigInt(mission.meteredBytes || '0')) mission.lastUsageAt = new Date().toISOString()
  mission.meteredBytes = totalBytes.toString()
  const totalMb = Number(totalBytes) / 1_000_000
  const costUsdc = totalMb * mission.destination.pricePerMbUsdc
  mission.consumedMb = parseFloat(totalMb.toFixed(2))
  mission.consumedUsdc = parseFloat(costUsdc.toFixed(6))
  mission.balanceUsdc = Math.max(0, parseFloat((mission.budgetUsdc - costUsdc).toFixed(6)))
}

/** USDC (number) to raw units (1e-7 USDC). */
function usdcToRaw(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1e7))
}

/** Raw units (1e-7 USDC) to USDC, rounded to 6 decimals. */
function rawToUsdc(raw: bigint): number {
  return Number(raw) / 1e7
}

/** A non-empty raw-unit environment variable, or `undefined`. */
function envRaw(key: string): bigint | undefined {
  const value = process.env[key]
  return value ? parseNonNegativeIntegerRaw(value) : undefined
}

/**
 * What the trip has used so far, in USDC atomic units, rounded down: the
 * metered bytes at the mission's price (`PRICE_PER_MB_RAW` when set). The one
 * figure for money: a claim collects it, a close settles it and the app is
 * asked to sign for it, so they can never disagree by a rounding unit.
 */
export function usedAtomic(mission: Pick<ProductMission, 'meteredBytes' | 'destination'>): bigint {
  const pricePerMbRaw = envRaw('PRICE_PER_MB_RAW') ?? usdcToRaw(mission.destination.pricePerMbUsdc)
  return rawToAtomicFloor(computeCostRaw(BigInt(mission.meteredBytes || '0'), pricePerMbRaw))
}

/** How long an answer of the rail's readiness check is reused, by answer. */
const RAIL_CHECK_TTL_MS = {
  /** Ready: the key is the operator or the payee. Only `setOperator` changes that. */
  ready: 60_000,
  /** The key is not allowed: asked again soon, so a fix shows up quickly. */
  operator_not_authorized: 15_000,
  /** The chain could not be asked: barely kept, so a blip is not held against the rail. */
  upstream_unavailable: 3_000,
} as const

export type Readiness = { ready: true } | { ready: false; reason: string; detail: string }

/** The same transaction, however the caller wrote its hash. */
function sameTx(a: string | undefined, b: string): boolean {
  return a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Sets what the trip can spend to what its channel holds. The figures are
 * the chain's total, set and never added to, so confirming a deposit again
 * cannot raise them.
 */
function applyChannelDeposit(mission: ProductMission, depositRaw: bigint): void {
  const depositAtomic = rawToAtomicCeil(depositRaw)
  mission.depositAtomic = depositAtomic.toString()
  mission.budgetUsdc = Number(formatAtomic(depositAtomic))
  mission.balanceUsdc = Math.max(0, parseFloat((mission.budgetUsdc - mission.consumedUsdc).toFixed(6)))
}

/**
 * Reasons that are no verdict on the payment: the chain could not be asked,
 * or has not included the transaction yet. Asking again may succeed.
 */
const UNDECIDED_DEPOSIT_REASONS = new Set(['tx_not_found'])

function unavailable(message: string): Error {
  const err = new Error(`503: ${message}`)
  ;(err as unknown as { statusCode: number }).statusCode = 503
  return err
}

export type AdvanceResult = {
  missionId: string
  fundedCents: number
  claimTxHash?: string
  closeTxHash?: string
  closeReason?: AutoCloseReason
  error?: string
}

export type MissionProductServiceOptions = {
  repo: MissionRepository
  /** What happened to each trip, in order. Kept in memory when not given. */
  missionLog?: MissionLog
  connectivity: ConnectivityProvider
  /** How missions are paid: a real chain, or FakeRail for demos. */
  rail: PaymentRail
  hasCitrusReal?: boolean
  fundFlow?: FundFlowConfig
  logger?: (line: Record<string, unknown>) => void
  /** Clock of the rail readiness cache, in milliseconds. Injectable for tests. */
  now?: () => number
}

export class MissionProductService {
  private repo: MissionRepository
  private missionLog: MissionLog
  private connectivity: ConnectivityProvider
  private rail: PaymentRail
  private hasCitrusReal: boolean
  private fundFlow: FundFlowConfig
  private logger: (line: Record<string, unknown>) => void
  private now: () => number
  private locks = createChannelMutex()
  private marginErrorLogged = false
  /** Last answer of the rail's readiness check, shared by callers until it expires. */
  private railCheck?: { answer: Promise<Readiness>; expiresAt: number }

  // Active sessions & meter services per mission
  private sessions = new Map<string, ConnectivitySession>()
  private meters = new Map<string, IntegratedMeterService>()

  constructor(options: MissionProductServiceOptions) {
    this.repo = options.repo
    this.missionLog = options.missionLog ?? new MemoryMissionLog()
    this.connectivity = options.connectivity
    this.rail = options.rail
    this.hasCitrusReal = options.hasCitrusReal ?? false
    this.fundFlow = options.fundFlow ?? DEFAULT_FUND_FLOW
    this.logger = options.logger ?? ((line) => console.log(JSON.stringify(line)))
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Adds an entry to the trip's log. Call it after the change it describes was
   * saved. A log that cannot be written never fails the operation: it is
   * reported. `data` holds amounts and transaction hashes only, never a
   * signature, a key, or the eSIM's activation code.
   */
  private record(mission: ProductMission, type: MissionLogType, data: MissionLogEntry['data']): void {
    try {
      this.missionLog.append({ v: 1, at: new Date().toISOString(), missionId: mission.id, iccid: mission.iccid ?? null, type, data })
    } catch (error) {
      this.logger({ level: 'error', msg: 'mission log not written', missionId: mission.id, type, detail: messageOf(error) })
    }
  }

  /** The trip's log, oldest first. Fails for an unknown trip. */
  async getMissionLog(missionId: string): Promise<MissionLogEntry[]> {
    await this.load(missionId)
    return this.missionLog.list(missionId)
  }

  private isLiveMode(): boolean {
    return process.env.ASTROAM_LIVE_ENABLED === 'true'
  }

  private async load(missionId: string): Promise<ProductMission> {
    const mission = await this.repo.findById(missionId)
    if (!mission) throw new Error(`Mission ${missionId} not found`)
    return mission
  }

  private getMissingConfiguration(): string[] {
    const missing: string[] = []
    if (!this.rail.isLive) missing.push('PAYMENT_RAIL')
    if (!process.env.CITRUS_API_KEY) missing.push('CITRUS_API_KEY')
    if (this.isLiveMode()) {
      if (!process.env.ASTROAM_DEMO_ACCESS_TOKEN) missing.push('ASTROAM_DEMO_ACCESS_TOKEN')
      if (isWildcardOrigin(process.env.FRONTEND_ORIGIN)) missing.push('FRONTEND_ORIGIN')
    }
    return missing
  }

  async getCapabilities(): Promise<Capabilities> {
    const isLive = this.isLiveMode()
    // A live rail that cannot settle takes no payments: the app shows its notice.
    const railReady = this.rail.isLive && (await this.getReadiness()).ready
    const citrusReady = this.hasCitrusReal

    let mode: Capabilities['mode'] = 'demo'
    if (isLive) {
      mode = railReady && citrusReady ? 'live' : railReady || citrusReady ? 'partial' : 'demo'
    }

    return {
      backendAvailable: true,
      network: this.rail.network,
      paymentRail: this.rail.displayName,
      paymentsLive: railReady,
      voucherSigning: this.rail.voucherSigning,
      channelReady: railReady,
      citrusReady,
      connectivityProvider: citrusReady ? 'citrus' : 'fake',
      citrusStatus: citrusReady ? 'live' : 'unavailable',
      meteringMode: isLive ? (railReady && citrusReady ? 'real' : 'unavailable') : 'demo',
      reconciliationAvailable: citrusReady,
      demoTrafficEnabled: process.env.ENABLE_DEMO_TRAFFIC === 'true',
      mode,
      liveEnabled: isLive,
      requiresAuth: isLive && Boolean(process.env.ASTROAM_DEMO_ACCESS_TOKEN),
      missingConfiguration: this.getMissingConfiguration(),
    }
  }

  /**
   * Whether the server can do its part of a trip. Not ready when the payment
   * rail's key is not allowed to collect and close: deposits would still
   * land in the escrow, and nobody here could settle them.
   *
   * The answer is reused for a short time (`RAIL_CHECK_TTL_MS`), so `/ready`,
   * the capabilities and every intent do not each ask the chain. A rail with
   * no key of its own (FakeRail) is always ready.
   */
  getReadiness(): Promise<Readiness> {
    const checkOperator = this.rail.checkOperator?.bind(this.rail)
    if (!checkOperator) return Promise.resolve({ ready: true })
    if (this.railCheck && this.now() < this.railCheck.expiresAt) return this.railCheck.answer

    // Callers that arrive while the chain is being asked share this one question.
    const entry = { answer: Promise.resolve<Readiness>({ ready: true }), expiresAt: Number.POSITIVE_INFINITY }
    entry.answer = checkOperator().then(
      (check): Readiness => {
        entry.expiresAt = this.now() + RAIL_CHECK_TTL_MS[check.authorized ? 'ready' : check.reason]
        return check.authorized ? { ready: true } : { ready: false, reason: check.reason, detail: check.detail }
      },
      (error): Readiness => {
        entry.expiresAt = this.now() + RAIL_CHECK_TTL_MS.upstream_unavailable
        return { ready: false, reason: 'upstream_unavailable', detail: messageOf(error) }
      },
    )
    this.railCheck = entry
    return entry.answer
  }

  /**
   * A deposit is never invited into an escrow this server cannot settle: no
   * intent is issued while the rail is not ready.
   */
  private async assertRailCanSettle(): Promise<void> {
    const readiness = await this.getReadiness()
    if (!readiness.ready) {
      throw unavailable(`payments are not available: the payment rail cannot settle deposits right now (${readiness.reason})`)
    }
  }

  async createMission(payload: {
    userId?: string
    destination: DestinationInfo
    startDate: string
    endDate: string
    budgetUsdc: number
    dailyLimitUsdc: number
    autoPause?: boolean
    lowBalanceAlert?: boolean
  }): Promise<{ id: string; status: string }> {
    const id = `mis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const start = new Date(payload.startDate)
    const end = new Date(payload.endDate)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    const durationDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))

    const mission: ProductMission = {
      id,
      userId: payload.userId || 'usr_demo',
      destination: payload.destination,
      startDate: payload.startDate,
      endDate: payload.endDate,
      durationDays,
      budgetUsdc: payload.budgetUsdc,
      dailyLimitUsdc: payload.dailyLimitUsdc,
      autoPause: payload.autoPause ?? true,
      lowBalanceAlert: payload.lowBalanceAlert ?? true,
      status: 'pending_payment',
      paymentStatus: 'pending',
      esimStatus: 'not_provisioned',
      meteredBytes: '0',
      carrierBytes: '0',
      balanceUsdc: payload.budgetUsdc,
      consumedUsdc: 0,
      consumedMb: 0,
      topups: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await this.repo.save(mission)
    return { id: mission.id, status: mission.status }
  }

  async createPaymentIntent(missionId: string) {
    return this.locks.withChannelLock(missionId, () => this.createPaymentIntentLocked(missionId))
  }

  /** Assumes the caller holds the mission's channel lock. */
  private async createPaymentIntentLocked(missionId: string) {
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }
    await this.assertRailCanSettle()

    await assertSufficientResellerBalance(this.connectivity)

    const intent = await this.rail.createDepositIntent({
      missionId: mission.id,
      amountUsdc: mission.budgetUsdc,
      purpose: 'mission',
    })

    mission.paymentIntentId = intent.intentId
    await this.repo.save(mission)

    return {
      intentId: intent.intentId,
      amount: String(intent.amountUsdc),
      asset: intent.asset,
      payTo: intent.payTo,
      paymentUri: intent.paymentUri,
      qr: intent.qr,
      network: this.rail.network,
      status: 'pending',
      isMock: intent.isMock,
      evm: intent.evm,
    }
  }

  async confirmPayment(missionId: string, intentId: string, txHash: string) {
    return this.locks.withChannelLock(missionId, () => this.confirmPaymentLocked(missionId, intentId, txHash))
  }

  /**
   * Assumes the caller holds the mission's channel lock.
   *
   * The deposit is checked against the chain alone: the rail derives the
   * escrow from the mission id, so only a deposit into this mission's own
   * escrow can pay for it, and a server restarted since the intent confirms
   * it all the same. `intentId` is a label and decides nothing. A mission is
   * paid once: its record keeps the transaction, and any later confirmation
   * returns that result without asking the rail.
   */
  private async confirmPaymentLocked(missionId: string, intentId: string, txHash: string) {
    const mission = await this.load(missionId)

    if (mission.paymentStatus === 'paid' && mission.depositTxHash) {
      return {
        valid: true,
        status: 'paid',
        depositTxHash: mission.depositTxHash,
        explorerUrl: mission.depositExplorerUrl,
        channelId: mission.channelId,
      }
    }

    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    const result = await this.rail.confirmDeposit({
      missionId,
      txHash,
      purpose: 'mission',
      amountUsdc: mission.budgetUsdc,
    })
    if (!result.valid) {
      // Only a verdict marks the payment failed; a later confirmation can still pay.
      if (!UNDECIDED_DEPOSIT_REASONS.has(result.reason)) {
        mission.paymentStatus = 'failed'
        await this.repo.save(mission)
      }
      throw new Error(`Deposit for intent ${intentId} was not accepted: ${result.reason}`)
    }

    mission.paymentStatus = 'paid'
    mission.status = 'paid'
    mission.depositTxHash = result.txHash
    mission.depositExplorerUrl = result.explorerUrl
    mission.channelId = result.channelId
    mission.escrowId = result.channelId
    // What the escrow holds, which need not be what the mission asked for.
    applyChannelDeposit(mission, result.depositRaw)
    mission.depositVerified = true
    if (result.travelerAddress) mission.travelerAddress = result.travelerAddress
    if (result.sessionKey) mission.sessionKey = result.sessionKey
    mission.escrowActiveAt = result.escrowActiveAt ?? new Date().toISOString()
    await this.repo.save(mission)

    return {
      valid: true,
      status: 'paid',
      depositTxHash: result.txHash,
      explorerUrl: result.explorerUrl,
      channelId: result.channelId,
    }
  }

  async activateMission(missionId: string) {
    return this.locks.withChannelLock(missionId, () => this.activateMissionLocked(missionId))
  }

  /** Assumes the caller holds the mission's channel lock. */
  private async activateMissionLocked(missionId: string) {
    const mission = await this.load(missionId)

    if (mission.paymentStatus !== 'paid' || !mission.channelId) {
      throw new Error('A mission can only be activated after its deposit is confirmed')
    }
    if (this.isLiveMode() && !this.hasCitrusReal) {
      throw unavailable('Citrus Mobile is not configured for live mode (missing CITRUS_API_KEY)')
    }

    // Idempotent
    if (mission.status === 'active' && mission.iccid && mission.esim) {
      return { missionId: mission.id, status: mission.status, isMock: !this.hasCitrusReal, esim: mission.esim }
    }

    await assertSufficientResellerBalance(this.connectivity)

    const esimRecord = await this.connectivity.provisionEsim(mission.userId)
    const publicEsim: PublicEsimInfo = {
      iccid: esimRecord.iccid,
      lpaString: esimRecord.lpaString,
      qrCode: esimRecord.qrCode,
      directInstallUrl: esimRecord.directInstallUrl,
      status: esimRecord.status,
      isMock: !this.hasCitrusReal,
    }

    mission.iccid = esimRecord.iccid
    mission.esim = publicEsim
    mission.status = 'active'
    mission.esimStatus = 'active'

    this.sessions.set(
      mission.id,
      createConnectivitySession({
        id: `ses_${mission.id}`,
        userId: mission.userId,
        iccid: esimRecord.iccid,
        channelId: mission.channelId,
      }),
    )

    // The provider's charged figure is lifetime: what it shows now is not this trip's.
    try {
      mission.chargedBaselineMicroUsd = (await this.connectivity.getUsage(esimRecord.iccid)).chargedMicroUsd.toString()
    } catch {
      // The first usage reading sets the baseline instead.
    }
    await this.repo.save(mission)
    this.record(mission, 'esim.provisioned', {
      isMock: !this.hasCitrusReal,
      providerStatus: esimRecord.status,
      budgetUsdc: mission.budgetUsdc,
    })
    if (mission.chargedBaselineMicroUsd !== undefined) {
      this.record(mission, 'usage.baseline', { chargedBaselineMicroUsd: mission.chargedBaselineMicroUsd })
    }

    // First tranche. A failure here does not undo the activation: the fund-flow job retries.
    try {
      await this.fundTranche(mission)
    } catch (error) {
      this.logger({ level: 'error', msg: 'first tranche not funded', missionId: mission.id, detail: messageOf(error) })
    }

    return { missionId: mission.id, status: 'active', isMock: !this.hasCitrusReal, esim: publicEsim }
  }

  async getMission(missionId: string): Promise<ProductMission> {
    return this.load(missionId)
  }

  async getUsage(missionId: string) {
    const mission = await this.load(missionId)

    let session = this.sessions.get(missionId)
    if (!session && mission.iccid && mission.channelId) {
      session = createConnectivitySession({
        id: `ses_${mission.id}`,
        userId: mission.userId,
        iccid: mission.iccid,
        channelId: mission.channelId,
      })
      this.sessions.set(missionId, session)
    }

    if (!session || !mission.iccid) {
      return {
        chargedMicroUsd: '0',
        walletMicroUsd: '0',
        providerStatus: 'not_provisioned',
        meteredBytes: mission.meteredBytes,
        carrierBytes: '0',
        differenceBytes: mission.meteredBytes,
        isEstimation: true,
        note: 'Estimate based on the USDC rate',
      }
    }

    const recon = await runReconciliation(session, { provider: this.connectivity })
    const usage = await this.connectivity.getUsage(mission.iccid)

    return {
      chargedMicroUsd: recon.chargedMicroUsd.toString(),
      tripChargedMicroUsd: recon.tripChargedMicroUsd.toString(),
      walletMicroUsd: recon.walletMicroUsd.toString(),
      providerStatus: usage.status,
      meteredBytes: mission.meteredBytes,
      carrierBytes: mission.carrierBytes,
      differenceBytes: (BigInt(mission.meteredBytes) - BigInt(mission.carrierBytes)).toString(),
      isEstimation: true,
      note: 'Estimate based on the USDC rate',
    }
  }

  async pauseMission(missionId: string) {
    return this.locks.withChannelLock(missionId, () => this.pauseMissionLocked(missionId))
  }

  /** Assumes the caller holds the mission's channel lock. */
  private async pauseMissionLocked(missionId: string) {
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.hasCitrusReal) {
      throw unavailable('Citrus Mobile is not configured for live mode')
    }

    if (mission.iccid) await this.connectivity.suspend(mission.iccid)

    mission.esimStatus = 'paused'
    mission.status = 'paused'
    if (mission.esim) mission.esim.status = 'suspended'
    await this.repo.save(mission)
    this.record(mission, 'esim.paused', { reason: 'traveler' })

    return { status: 'paused', esimStatus: 'paused' }
  }

  async resumeMission(missionId: string) {
    return this.locks.withChannelLock(missionId, () => this.resumeMissionLocked(missionId))
  }

  /** Assumes the caller holds the mission's channel lock. */
  private async resumeMissionLocked(missionId: string) {
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.hasCitrusReal) {
      throw unavailable('Citrus Mobile is not configured for live mode')
    }

    if (mission.iccid) await this.connectivity.resume(mission.iccid)

    mission.esimStatus = 'active'
    mission.status = 'active'
    if (mission.esim) mission.esim.status = 'active'
    await this.repo.save(mission)
    this.record(mission, 'esim.resumed', { reason: 'traveler' })

    return { status: 'active', esimStatus: 'active' }
  }

  async createTopUpIntent(missionId: string, amountUsdc: number) {
    return this.locks.withChannelLock(missionId, () => this.createTopUpIntentLocked(missionId, amountUsdc))
  }

  /** Assumes the caller holds the mission's channel lock. */
  private async createTopUpIntentLocked(missionId: string, amountUsdc: number) {
    const mission = await this.load(missionId)
    if (!mission.channelId) throw new Error('This mission has no payment channel yet')
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }
    await this.assertRailCanSettle()

    const intent = await this.rail.createDepositIntent({
      missionId,
      amountUsdc,
      purpose: 'topup',
      channelId: mission.channelId,
    })

    mission.topups.push({
      id: `top_${Date.now()}`,
      intentId: intent.intentId,
      amountUsdc,
      status: 'pending',
      createdAt: new Date().toISOString(),
    })
    await this.repo.save(mission)

    return {
      intentId: intent.intentId,
      amount: String(intent.amountUsdc),
      asset: intent.asset,
      payTo: intent.payTo,
      paymentUri: intent.paymentUri,
      qr: intent.qr,
      network: this.rail.network,
      status: 'pending',
      isMock: intent.isMock,
      evm: intent.evm,
    }
  }

  /**
   * A voucher the traveler's app signed with its session key for the running
   * total it authorizes. Data is credited only up to the highest one.
   */
  async authorizeUsage(missionId: string, cumulativeAmount: string, signature: string) {
    const res = await this.submitVoucher(missionId, { cumulativeAtomic: cumulativeAmount, signature })
    const mission = await this.load(missionId)
    const authorizedRaw =
      mission.channelId && this.rail.getAuthorizedRaw
        ? await this.rail.getAuthorizedRaw(mission.channelId)
        : atomicToRaw(BigInt(res.cumulativeAtomic))
    return { authorizedUsdc: Number(authorizedRaw) / 1e7 }
  }

  async getAuthorization(missionId: string) {
    const mission = await this.load(missionId)
    const authorizedRaw = mission.channelId && this.rail.getAuthorizedRaw ? await this.rail.getAuthorizedRaw(mission.channelId) : 0n
    return { voucherSigning: this.rail.voucherSigning, authorizedUsdc: Number(authorizedRaw) / 1e7 }
  }

  async confirmTopUpPayment(missionId: string, intentId: string, txHash: string) {
    return this.locks.withChannelLock(missionId, () => this.confirmTopUpPaymentLocked(missionId, intentId, txHash))
  }

  /**
   * Assumes the caller holds the mission's channel lock.
   *
   * A top-up is credited once per transaction, and not from memory:
   *
   * - The settled top-ups of the mission record are the transactions already
   *   credited. They are saved with the mission, so they hold across a
   *   restart; a transaction found there returns its earlier result.
   * - The budget is the escrow's on-chain total, set and never added to.
   * - The record is saved before the eSIM wallet is funded, so a crash in
   *   between cannot fund it a second time.
   *
   * `intentId` is a label: it picks which pending top-up the transaction
   * settles. A transaction that did top up this mission's escrow is credited
   * even when no pending top-up carries that label.
   */
  private async confirmTopUpPaymentLocked(missionId: string, intentId: string, txHash: string) {
    const mission = await this.load(missionId)
    if (!mission.channelId) throw new Error('This mission has no payment channel yet')

    const credited = mission.topups.find((t) => t.status === 'settled' && sameTx(t.txHash, txHash))
    if (credited) {
      return {
        valid: true,
        status: 'settled',
        txHash: credited.txHash!,
        explorerUrl: credited.explorerUrl,
        balanceUsdc: mission.balanceUsdc,
      }
    }
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    const pending = mission.topups.find((t) => t.intentId === intentId && t.status === 'pending')
    const result = await this.rail.confirmDeposit({
      missionId,
      txHash,
      purpose: 'topup',
      channelId: mission.channelId,
      amountUsdc: pending?.amountUsdc,
    })
    if (!result.valid) throw new Error(`Top-up was not accepted: ${result.reason}`)

    // What the transaction added, which need not be what the intent asked for.
    const addedUsdc = rawToUsdc(result.amountRaw)
    const topup: TopUpRecord = pending ?? {
      id: `top_${Date.now()}`,
      intentId,
      amountUsdc: addedUsdc,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    if (!pending) mission.topups.push(topup)
    topup.amountUsdc = addedUsdc
    topup.status = 'settled'
    topup.txHash = result.txHash
    topup.explorerUrl = result.explorerUrl
    applyChannelDeposit(mission, result.depositRaw)
    // A top-up restarts the escrow's refund timeout.
    if (result.escrowActiveAt) mission.escrowActiveAt = result.escrowActiveAt
    const resumed = mission.status === 'paused' && mission.balanceUsdc > 0
    if (resumed) {
      mission.status = 'active'
      mission.esimStatus = 'active'
    }
    await this.repo.save(mission)
    if (resumed) this.record(mission, 'esim.resumed', { reason: 'topup' })

    if (mission.iccid) {
      try {
        const cents = Math.max(1, Math.round(addedUsdc * 100))
        await this.connectivity.topUp(mission.iccid, cents)
        this.record(mission, 'esim.funded', { amountCents: cents, source: 'topup', fundedCents: mission.fundedCents ?? 0 })
      } catch {
        // The eSIM wallet catches up on the next funding pass.
      }
    }

    return {
      valid: true,
      status: 'settled',
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      balanceUsdc: mission.balanceUsdc,
    }
  }

  async finishMission(missionId: string) {
    return this.locks.withChannelLock(missionId, () => this.finishMissionLocked(missionId))
  }

  /**
   * What a close settles: the usage. Claims collect at most the usage
   * (`claimIfDue`), so the usage is never below what was claimed and nothing
   * else is needed in normal operation.
   *
   * The one exception is a trip found with more claimed than it metered:
   * state from before claims were bounded by usage, or a usage figure
   * corrected downward. The contract cannot settle below what the payee
   * already holds, so such a trip closes at the claimed total instead of not
   * closing at all, and `aboveUsageAtomic` says by how much. The caller
   * records it (`recordClosedAboveUsage`): it is never absorbed silently.
   */
  private async settlementFor(
    mission: ProductMission,
  ): Promise<{ usedAtomic: bigint; settleAtomic: bigint; aboveUsageAtomic: bigint }> {
    const used = usedAtomic(mission)
    let claimed = BigInt(mission.claimedAtomic ?? '0')
    // The chain may hold a claim the record missed, and the chain is what the contract enforces.
    if (this.rail.readEscrowState && mission.channelId) {
      const state = await this.rail.readEscrowState(mission.channelId)
      if (state && state.claimedAtomic > claimed) claimed = state.claimedAtomic
    }
    if (claimed <= used) return { usedAtomic: used, settleAtomic: used, aboveUsageAtomic: 0n }
    return { usedAtomic: used, settleAtomic: claimed, aboveUsageAtomic: claimed - used }
  }

  /**
   * Marks, in the mission and the log, a trip whose close paid more than it
   * metered. Judged on what the close actually settled, not on what was asked.
   */
  private recordClosedAboveUsage(mission: ProductMission, used: bigint, settled: bigint): void {
    if (settled <= used) return
    mission.closedAboveUsageAtomic = (settled - used).toString()
    this.logger({
      level: 'error',
      msg: 'trip closed above its metered usage',
      missionId: mission.id,
      usedAtomic: used.toString(),
      settledAtomic: settled.toString(),
      aboveUsageAtomic: mission.closedAboveUsageAtomic,
    })
  }

  /**
   * Assumes the caller holds the mission's channel lock. Finishing a trip that
   * is already completed returns the same result and sends nothing.
   */
  private async finishMissionLocked(missionId: string) {
    const mission = await this.load(missionId)
    if (mission.status === 'completed') {
      // A trip with no close of any kind recorded was completed with nothing to settle.
      return this.finishResult(mission, mission.closeTxHash || mission.settlement ? 'closed' : 'nothing_to_close')
    }
    if (!mission.channelId) throw new Error('This mission has no payment channel to close')
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    // Settle exactly what was used, in integer units (never a float): the
    // same figure the claims collected up to.
    const settlement = await this.settlementFor(mission)
    const kind = await this.closeEscrow(mission, settlement, settlement.settleAtomic)
    return this.finishResult(mission, kind === 'settled_on_chain' ? 'closed' : kind)
  }

  private finishResult(mission: ProductMission, closeKind: string) {
    return {
      status: 'completed',
      closeKind,
      txHash: mission.closeTxHash,
      explorerUrl: mission.closeExplorerUrl,
      settledUsdc: mission.settledUsdc,
      refundedUsdc: mission.refundedUsdc,
    }
  }

  /**
   * The one way a trip's escrow is closed and the trip recorded as completed,
   * for the traveler's finish, their final voucher and the automatic close.
   *
   * - The escrow is closed first. The eSIM wallet is only defunded once the
   *   escrow is known to be closed, so a close that fails leaves the trip as
   *   it was, with its line funded.
   * - A close that fails while the chain reports the escrow settled (it
   *   landed, but the record was never saved, or it was closed from outside
   *   the app) is not an error: the trip is recorded as completed from the
   *   chain, with no close transaction hash. The chain does not keep what the
   *   close paid once it is settled, so the figure is what this close would
   *   have settled, and never below what the chain says was claimed.
   *
   * Returns what happened to the channel. Assumes the channel lock is held.
   */
  private async closeEscrow(
    mission: ProductMission,
    settlement: { usedAtomic: bigint },
    settleAtomic: bigint,
    reason?: AutoCloseReason,
  ): Promise<'closed' | 'closed_unverified' | 'nothing_to_close' | 'settled_on_chain'> {
    const outcome = await this.rail.closeChannel(mission.channelId!, atomicToRaw(settleAtomic))
    if (outcome.kind === 'blocked') {
      throw new Error(`Could not close the payment channel: ${outcome.detail}`)
    }

    let chainDeposit: bigint | undefined
    let chainClaimed = 0n
    if (outcome.kind === 'failed') {
      if (this.rail.readEscrowState) {
        const state = await this.rail.readEscrowState(mission.channelId!)
        if (!state?.settled) throw new Error(`Could not close the payment channel: ${outcome.detail}`)
        chainDeposit = state.depositAtomic
        chainClaimed = state.claimedAtomic
      } else if (!outcome.detail.includes('already settled') && !outcome.detail.includes('already closed')) {
        throw new Error(`Could not close the payment channel: ${outcome.detail}`)
      }
    }

    // The escrow is closed: only now does the eSIM wallet go back to the reseller.
    if (mission.iccid) {
      try {
        await this.connectivity.refundUnused(mission.iccid)
      } catch {
        // The eSIM wallet is reconciled by the session closer; the USDC refund does not wait for it.
      }
    }

    const deposit = chainDeposit ?? BigInt(mission.depositAtomic ?? '0')
    let settled: bigint
    let kind: 'closed' | 'closed_unverified' | 'nothing_to_close' | 'settled_on_chain'
    if (outcome.kind === 'closed' || outcome.kind === 'closed_unverified') {
      settled = rawToAtomicFloor(outcome.settledRaw)
      kind = outcome.kind
    } else if (outcome.kind === 'nothing_to_close') {
      settled = 0n
      kind = 'nothing_to_close'
    } else {
      settled = settleAtomic > chainClaimed ? settleAtomic : chainClaimed
      if (deposit > 0n && settled > deposit) settled = deposit
      kind = 'settled_on_chain'
    }

    mission.status = 'completed'
    mission.esimStatus = 'disabled'
    if (kind === 'nothing_to_close') {
      mission.settledUsdc = 0
      mission.refundedUsdc = mission.budgetUsdc
    } else {
      mission.settlement = 'close'
      mission.settledUsdc = Number(formatAtomic(settled))
      mission.refundedUsdc =
        outcome.kind === 'closed' ? rawToUsdc(outcome.refundedRaw) : Number(formatAtomic(deposit > settled ? deposit - settled : 0n))
      mission.claimedAtomic = settled.toString()
      if (outcome.kind === 'closed' || outcome.kind === 'closed_unverified') {
        mission.closeTxHash = outcome.txHash
        mission.closeExplorerUrl = outcome.explorerUrl
        this.recordClosedAboveUsage(mission, settlement.usedAtomic, settled)
      }
    }
    if (reason) mission.autoCloseReason = reason
    await this.repo.save(mission)
    this.record(mission, 'mission.closed', {
      txHash: mission.closeTxHash ?? null,
      closeKind: kind,
      reason: reason ?? 'traveler',
      meteredBytes: mission.meteredBytes,
      settledUsdc: mission.settledUsdc ?? null,
      refundedUsdc: mission.refundedUsdc ?? null,
      closedAboveUsageAtomic: mission.closedAboveUsageAtomic ?? null,
    })
    this.logger({ level: 'info', msg: 'escrow close', missionId: mission.id, txHash: mission.closeTxHash, reason: reason ?? 'traveler' })
    return kind
  }

  /**
   * Gives the whole deposit back for a trip that was paid but never started
   * (no eSIM, no usage). The rail closes the channel with nothing to settle.
   */
  async cancelMission(missionId: string) {
    return this.locks.withChannelLock(missionId, () => this.cancelMissionLocked(missionId))
  }

  /** Assumes the caller holds the mission's channel lock. */
  private async cancelMissionLocked(missionId: string) {
    const mission = await this.load(missionId)
    const result = () => ({
      status: 'cancelled' as const,
      txHash: mission.closeTxHash,
      explorerUrl: mission.closeExplorerUrl,
      refundedUsdc: mission.refundedUsdc,
    })
    if (mission.status === 'cancelled') return result()
    if (mission.paymentStatus !== 'paid' || !mission.channelId) {
      throw new Error('Only a paid trip can be cancelled and refunded')
    }
    if (mission.status !== 'paid' || mission.iccid || BigInt(mission.meteredBytes || '0') > 0n) {
      throw new Error('This trip already started; finish it instead so what you used is settled')
    }

    const outcome = await this.rail.closeChannel(mission.channelId, 0n)
    // The channel was already closed outside the app (e.g. scripts/close-escrow.ts):
    // the chain is the source of truth, so the record just catches up.
    const alreadySettled = outcome.kind === 'failed' && outcome.detail.includes('already settled')
    if ((outcome.kind === 'failed' && !alreadySettled) || outcome.kind === 'blocked') {
      throw new Error(`Could not refund the deposit: ${outcome.detail}`)
    }

    mission.status = 'cancelled'
    mission.esimStatus = 'disabled'
    mission.settledUsdc = 0
    if (outcome.kind === 'closed') {
      mission.closeTxHash = outcome.txHash
      mission.closeExplorerUrl = outcome.explorerUrl
      mission.refundedUsdc = rawToUsdc(outcome.refundedRaw)
    } else if (!alreadySettled) {
      mission.refundedUsdc = mission.budgetUsdc
    }
    await this.repo.save(mission)
    this.record(mission, 'mission.closed', {
      txHash: mission.closeTxHash ?? null,
      closeKind: 'cancelled',
      reason: 'traveler',
      meteredBytes: mission.meteredBytes,
      settledUsdc: 0,
      refundedUsdc: mission.refundedUsdc ?? null,
      closedAboveUsageAtomic: null,
    })
    return result()
  }

  private getOrCreateMeterService(mission: ProductMission, channelId: string): IntegratedMeterService {
    const existing = this.meters.get(mission.id)
    if (existing) return existing

    let session = this.sessions.get(mission.id)
    if (!session) {
      session = createConnectivitySession({
        id: `ses_${mission.id}`,
        userId: mission.userId,
        iccid: mission.iccid || `iccid_${mission.id}`,
        channelId,
      })
      this.sessions.set(mission.id, session)
    }

    // Rate: PRICE_PER_MB_RAW when set; otherwise the destination's own rate,
    // the one the app shows. Vouchers bill the same rate per MiB.
    const pricePerMbRaw = envRaw('PRICE_PER_MB_RAW') ?? usdcToRaw(mission.destination.pricePerMbUsdc)
    const rail = this.rail
    const balancePort: ChannelBalancePort = {
      getChannelBalance: (id) => rail.getChannelDepositRaw(id),
    }

    const meterService = new IntegratedMeterService({
      session,
      provider: this.connectivity,
      balancePort,
      voucherPort: rail.voucherPortFor(channelId),
      network: rail.network,
      pricePerMbRaw,
      voucherPricePerMibRaw: pricePerMibFromPerMbRaw(pricePerMbRaw),
    })

    this.meters.set(mission.id, meterService)
    return meterService
  }

  async processDemoTraffic(missionId: string, bytes: number) {
    if (process.env.ENABLE_DEMO_TRAFFIC !== 'true') {
      throw new Error('Demo traffic injection is not enabled on this server')
    }
    return this.locks.withChannelLock(missionId, () => this.processDemoTrafficLocked(missionId, bytes))
  }

  /** Assumes the caller holds the mission's channel lock. */
  private async processDemoTrafficLocked(missionId: string, bytes: number) {
    const mission = await this.load(missionId)
    if (mission.status !== 'active' || mission.esimStatus !== 'active' || !mission.channelId) {
      throw new Error('Traffic can only be injected into an active mission')
    }
    if (this.isLiveMode() && (!this.rail.isLive || !this.hasCitrusReal)) {
      throw unavailable('live mode needs both a live payment rail and Citrus Mobile to meter traffic')
    }

    const meterService = this.getOrCreateMeterService(mission, mission.channelId)
    const result = await meterService.processTraffic(bytes)

    const currentBytes = BigInt(mission.meteredBytes || '0') + BigInt(bytes)
    applyMeteredBytes(mission, currentBytes)

    const suspended = result.actionApplied.kind === 'suspend' || mission.balanceUsdc <= 0
    if (suspended) {
      mission.status = 'paused'
      mission.esimStatus = 'paused'
    }

    await this.repo.save(mission)
    this.record(mission, 'usage.demo_traffic', usageData(mission, { bytes }))
    if (suspended) this.record(mission, 'esim.paused', { reason: 'budget_exhausted' })

    let cumulativeAmount: string | undefined
    let remaining: string | undefined
    let reused: boolean | undefined
    let meterReadingId: string | undefined
    if (result.voucher.kind === 'signed') {
      cumulativeAmount = result.voucher.envelope.voucher.cumulativeAmount
      remaining = result.voucher.envelope.remaining
      reused = result.voucher.envelope.reused
      meterReadingId = result.voucher.envelope.meterReadingId
    } else if (result.voucher.kind === 'unsigned') {
      remaining = result.voucher.envelope.remaining
    }

    return {
      bytes,
      meterStatus: result.meterStatus,
      actionApplied: { ...result.actionApplied, remainingRaw: result.actionApplied.remainingRaw.toString() },
      voucher: result.voucher,
      cumulativeAmount,
      remaining,
      reused,
      meterReadingId,
      meteredBytes: mission.meteredBytes,
      consumedMb: mission.consumedMb,
      consumedUsdc: mission.consumedUsdc,
      balanceUsdc: mission.balanceUsdc,
      status: mission.status,
      demoTraffic: true,
    }
  }

  // ---------------------------------------------------------------------
  // Automatic fund flow: vouchers, tranches, claims and auto-close.
  // ---------------------------------------------------------------------

  /** What the app has to sign next, and what AstroAm already holds. */
  async voucherRequest(missionId: string) {
    const mission = await this.load(missionId)
    const depositAtomic = BigInt(mission.depositAtomic ?? '0')
    const meteredAtomic = usedAtomic(mission)
    const cumulativeAtomic = meteredAtomic > depositAtomic ? depositAtomic : meteredAtomic

    return {
      escrowId: mission.escrowId ?? mission.channelId ?? null,
      channelId: mission.channelId ?? null,
      depositAtomic: depositAtomic.toString(),
      cumulativeAtomic: cumulativeAtomic.toString(),
      signedAtomic: mission.voucher?.cumulativeAtomic ?? '0',
      claimedAtomic: mission.claimedAtomic ?? '0',
      sessionKey: mission.sessionKey ?? null,
      travelerAddress: mission.travelerAddress ?? null,
    }
  }

  /**
   * Checks a voucher and keeps it when it is the highest so far. It must be
   * acceptable to the payment rail, cannot exceed the deposit, and cannot
   * be lower than what was already claimed.
   */
  private async acceptVoucher(
    mission: ProductMission,
    voucher: { cumulativeAtomic: string; signature: string },
  ): Promise<boolean> {
    if (mission.paymentStatus !== 'paid' || mission.status === 'completed' || mission.status === 'cancelled') {
      throw new Error('This trip is not open, so it takes no vouchers')
    }
    const amount = BigInt(voucher.cumulativeAtomic)
    const deposit = BigInt(mission.depositAtomic ?? '0')

    if (deposit > 0n && amount > deposit) {
      throw new Error('The voucher authorizes more than the deposit')
    }
    const held = mission.voucher ? BigInt(mission.voucher.cumulativeAtomic) : -1n
    if (amount < held) throw new Error('A higher voucher was already received')
    if (amount < BigInt(mission.claimedAtomic ?? '0')) {
      throw new Error('The voucher is below what was already collected')
    }

    if (this.rail.submitTravelerVoucher && mission.channelId) {
      const result = await this.rail.submitTravelerVoucher({
        channelId: mission.channelId,
        cumulativeAmount: voucher.cumulativeAtomic,
        signature: voucher.signature,
      })
      if (!result.accepted) {
        throw new Error(`The voucher was not accepted by the payment rail: ${result.reason}`)
      }
    }

    if (amount === held) return false
    mission.voucher = {
      cumulativeAtomic: voucher.cumulativeAtomic,
      signature: voucher.signature,
      signedAt: new Date().toISOString(),
    }
    return true
  }

  /** Logs the highest voucher received, by amount: the signature stays out of the log. */
  private recordVoucher(mission: ProductMission): void {
    this.record(mission, 'voucher.received', {
      cumulativeAtomic: mission.voucher!.cumulativeAtomic,
      depositAtomic: mission.depositAtomic ?? '0',
    })
  }

  /** The app sends a cumulative voucher after a usage reading. Funds the next tranche when it covers one. */
  async submitVoucher(missionId: string, voucher: { cumulativeAtomic: string; signature: string }) {
    return this.locks.withChannelLock(missionId, async () => {
      const mission = await this.load(missionId)
      const isNew = await this.acceptVoucher(mission, voucher)
      if (isNew) {
        await this.repo.save(mission)
        this.recordVoucher(mission)
      }
      let fundedNow = 0
      try {
        fundedNow = await this.fundTranche(mission)
      } catch (error) {
        this.logger({ level: 'error', msg: 'tranche not funded', missionId, detail: messageOf(error) })
      }
      return {
        accepted: true,
        cumulativeAtomic: mission.voucher!.cumulativeAtomic,
        claimedAtomic: mission.claimedAtomic ?? '0',
        fundedCents: mission.fundedCents ?? 0,
        fundedNowCents: fundedNow,
      }
    })
  }

  /**
   * Keeps the eSIM wallet at most one tranche ahead of what the vouchers
   * cover. Only for a deposit read from the chain. Returns the cents funded.
   *
   * A fund is never blindly retried: the intent is saved before the call,
   * and an unconfirmed one is settled against what the eSIM holds.
   */
  private async fundTranche(mission: ProductMission): Promise<number> {
    if (!mission.depositVerified || !mission.iccid || mission.status !== 'active') return 0
    const iccid = mission.iccid
    let funded = mission.fundedCents ?? 0

    if (mission.pendingFund) {
      const usage = await this.connectivity.getUsage(iccid)
      const baseline = BigInt(mission.chargedBaselineMicroUsd ?? usage.chargedMicroUsd.toString())
      const spent = usage.chargedMicroUsd > baseline ? usage.chargedMicroUsd - baseline : 0n
      // Everything funded this trip is either still in the wallet or already spent.
      const expected = BigInt(funded + mission.pendingFund.amountCents - FUND_TOLERANCE_CENTS) * MICRO_USD_PER_CENT
      if (usage.walletMicroUsd + spent >= expected) funded += mission.pendingFund.amountCents
      mission.fundedCents = funded
      mission.pendingFund = undefined
      await this.repo.save(mission)
    }

    const amount = nextFundCents(
      {
        depositAtomic: BigInt(mission.depositAtomic ?? '0'),
        voucherAtomic: BigInt(mission.voucher?.cumulativeAtomic ?? '0'),
        fundedCents: funded,
      },
      this.fundFlow,
    )
    if (amount === 0) return 0

    mission.pendingFund = { amountCents: amount, requestedAt: new Date().toISOString() }
    await this.repo.save(mission)
    await this.connectivity.topUp(iccid, amount)
    mission.fundedCents = funded + amount
    mission.pendingFund = undefined
    await this.repo.save(mission)
    this.record(mission, 'esim.funded', { amountCents: amount, source: 'tranche', fundedCents: mission.fundedCents })
    this.logger({ level: 'info', msg: 'esim tranche funded', missionId: mission.id, amountCents: amount, fundedCents: mission.fundedCents })
    return amount
  }

  /** Reads the provider's charged figure and turns this trip's part into metered usage. */
  private async readProviderUsage(mission: ProductMission): Promise<void> {
    if (!mission.iccid) return
    const usage = await this.connectivity.getUsage(mission.iccid)
    if (mission.chargedBaselineMicroUsd === undefined) {
      mission.chargedBaselineMicroUsd = usage.chargedMicroUsd.toString()
      await this.repo.save(mission)
      this.record(mission, 'usage.baseline', { chargedBaselineMicroUsd: mission.chargedBaselineMicroUsd })
      return
    }
    const baseline = BigInt(mission.chargedBaselineMicroUsd)
    const charged = usage.chargedMicroUsd > baseline ? usage.chargedMicroUsd - baseline : 0n
    const pricePerMbRaw = envRaw('PRICE_PER_MB_RAW') ?? usdcToRaw(mission.destination.pricePerMbUsdc)
    const bytes = equivalentBytes(charged, this.fundFlow.markupBps, this.fundFlow.usdcUsdRateBps, pricePerMbRaw)
    // Monotonic: a late or lower reading never takes usage back.
    if (bytes > BigInt(mission.meteredBytes || '0')) {
      applyMeteredBytes(mission, bytes)
      mission.carrierBytes = bytes.toString()
      await this.repo.save(mission)
      this.record(
        mission,
        'usage.reading',
        usageData(mission, {
          tripChargedMicroUsd: charged.toString(),
          walletMicroUsd: usage.walletMicroUsd.toString(),
          providerStatus: usage.status,
        }),
      )
    }
  }

  /** When the rail reports the channel's claimed total already covers `claimTotalAtomic`, records it. */
  private async recordClaimedOnChain(mission: ProductMission, claimTotalAtomic: bigint): Promise<boolean> {
    if (!this.rail.readEscrowState || !mission.channelId) return false
    const state = await this.rail.readEscrowState(mission.channelId)
    if (!state || state.claimedAtomic < claimTotalAtomic) return false
    mission.claimedAtomic = state.claimedAtomic.toString()
    if (state.activeAt) mission.escrowActiveAt = new Date(state.activeAt * 1000).toISOString()
    await this.repo.save(mission)
    // The claim landed earlier; its transaction is not known here.
    this.record(mission, 'escrow.claim', { txHash: null, cumulativeAtomic: mission.claimedAtomic, source: 'chain' })
    return true
  }

  /**
   * Sends a `claim` when a tranche of usage is not collected yet. It collects
   * what the trip used, up to the voucher: the voucher is a ceiling the app
   * signs ahead of usage, so claiming all of it would charge for data not
   * used. Claimed therefore never exceeds used, and a close at the used
   * amount (`settlementFor`) is never below what was claimed.
   */
  private async claimIfDue(mission: ProductMission, now: Date): Promise<ClaimRecord | null> {
    if (!this.rail.claim || !mission.depositVerified || !mission.channelId || !mission.voucher) return null
    const voucherAtomic = BigInt(mission.voucher.cumulativeAtomic)
    const claimTotal = claimableAtomic(usedAtomic(mission), voucherAtomic)
    if (!claimIsDue(claimTotal, BigInt(mission.claimedAtomic ?? '0'), this.fundFlow)) return null

    // The chain may already hold this claim (it landed, but was never recorded):
    // take what it says instead of sending it again.
    if (await this.recordClaimedOnChain(mission, claimTotal)) return null

    let txHash: string
    try {
      const claimRes = await this.rail.claim({
        channelId: mission.channelId,
        voucherAmountAtomic: voucherAtomic,
        signature: mission.voucher.signature,
        claimTotalAtomic: claimTotal,
      })
      txHash = claimRes.txHash
    } catch (error) {
      if (await this.recordClaimedOnChain(mission, claimTotal)) return null
      throw error
    }
    const record: ClaimRecord = {
      txHash,
      explorerUrl: this.rail.explorerTxUrl(txHash) ?? undefined,
      cumulativeAtomic: claimTotal.toString(),
      at: now.toISOString(),
      claimedAt: now.toISOString(),
    }
    mission.claimedAtomic = claimTotal.toString()
    mission.claims = [...(mission.claims ?? []), record]
    // A claim restarts the escrow's refund timeout.
    mission.escrowActiveAt = record.at
    await this.repo.save(mission)
    this.record(mission, 'escrow.claim', { txHash, cumulativeAtomic: record.cumulativeAtomic, source: 'backend' })
    this.logger({ level: 'info', msg: 'escrow claim', missionId: mission.id, txHash, cumulativeAtomic: record.cumulativeAtomic })
    return record
  }

  /** Closes the escrow with the highest voucher: the rest is paid and the traveler is refunded. */
  private async closeWithVoucher(mission: ProductMission, reason?: AutoCloseReason) {
    if (!mission.channelId || !mission.voucher) {
      throw new Error('There is no signed voucher to close this trip with')
    }
    // What was used, never above what the traveler signed. A trip found with
    // more claimed than used settles at the claimed total (see `settlementFor`).
    const settlement = await this.settlementFor(mission)
    const voucherAtomic = BigInt(mission.voucher.cumulativeAtomic)
    const settleAtomic =
      settlement.aboveUsageAtomic === 0n && settlement.settleAtomic > voucherAtomic ? voucherAtomic : settlement.settleAtomic

    await this.closeEscrow(mission, settlement, settleAtomic, reason)
    return {
      txHash: mission.closeTxHash,
      status: 'completed' as const,
      explorerUrl: mission.closeExplorerUrl,
      settlement: 'close' as const,
      settledUsdc: mission.settledUsdc,
      refundedUsdc: mission.refundedUsdc,
    }
  }

  /**
   * The traveler ends the trip and the backend sends the close. The app adds
   * the final voucher, signed by the session key: no wallet popup. That
   * voucher is also what shows the request comes from the traveler.
   */
  async settleMission(missionId: string, voucher?: { cumulativeAtomic: string; signature: string }) {
    return this.locks.withChannelLock(missionId, async () => {
      const mission = await this.load(missionId)
      if (mission.status === 'completed') {
        return {
          txHash: mission.closeTxHash,
          status: 'completed' as const,
          explorerUrl: mission.closeExplorerUrl,
          settlement: mission.settlement ?? ('close' as const),
          settledUsdc: mission.settledUsdc,
          refundedUsdc: mission.refundedUsdc,
        }
      }
      if (mission.paymentStatus !== 'paid') throw new Error('This mission has no confirmed deposit to close')
      if (!voucher && !mission.voucher) {
        throw new Error("Ending the trip needs its final voucher, signed by the trip's session key or wallet")
      }
      if (voucher && (await this.acceptVoucher(mission, voucher))) {
        await this.repo.save(mission)
        this.recordVoucher(mission)
      }
      return this.closeWithVoucher(mission)
    })
  }

  /** Trips the fund flow still has work on: paid, open, and with a deposit read from the chain. */
  async openMissionIds(): Promise<string[]> {
    const missions = await this.repo.findAll()
    return missions
      .filter((m) => m.depositVerified && m.paymentStatus === 'paid' && (m.status === 'active' || m.status === 'paused'))
      .map((m) => m.id)
  }

  /**
   * The refund timeout of the escrow this server settles on, as the rail reads
   * it from the contract; null when it cannot be known, in which case the
   * timeout-based auto-close is skipped for this pass (never a guessed value).
   * Also null, with one configuration error logged, when the close margin is
   * not smaller than the timeout. The rail keeps the timeout once read.
   */
  private async escrowTimeoutSeconds(missionId: string): Promise<number | null> {
    let timeout: number
    try {
      if (!this.rail.readTimeoutSeconds) throw new Error('the payment rail does not report the escrow timeout')
      timeout = await this.rail.readTimeoutSeconds()
    } catch (error) {
      this.logger({ level: 'error', msg: 'escrow timeout unknown: skipping the timeout auto-close', missionId, detail: messageOf(error) })
      return null
    }
    if (timeout <= this.fundFlow.closeMarginSeconds) {
      if (!this.marginErrorLogged) {
        this.marginErrorLogged = true
        this.logger({
          level: 'error',
          msg: 'ESCROW_CLOSE_MARGIN_SECONDS is not smaller than the escrow timeout: trips are not closed on the timeout',
          closeMarginSeconds: this.fundFlow.closeMarginSeconds,
          timeoutSeconds: timeout,
        })
      }
      return null
    }
    return timeout
  }

  /**
   * One pass of the fund flow for a trip: read usage, fund the next tranche,
   * collect what the voucher covers, and close when it is time. Never throws:
   * a failed step is reported and the next pass retries.
   */
  async advance(missionId: string, now: Date = new Date()): Promise<AdvanceResult> {
    return this.locks.withChannelLock(missionId, async () => {
      const result: AdvanceResult = { missionId, fundedCents: 0 }
      try {
        const mission = await this.load(missionId)
        if (!mission.depositVerified || mission.paymentStatus !== 'paid') return result
        if (mission.status !== 'active' && mission.status !== 'paused') return result

        await this.readProviderUsage(mission)

        const reason = autoCloseReason(mission, usedAtomic(mission), this.fundFlow, now, await this.escrowTimeoutSeconds(missionId))
        if (reason && mission.voucher) {
          const closed = await this.closeWithVoucher(mission, reason)
          result.closeTxHash = closed.txHash
          result.closeReason = reason
          return result
        }
        if (reason) {
          // Nothing signed: the escrow's own timeout refund is what returns this deposit.
          this.logger({ level: 'warn', msg: 'trip is due to close but has no voucher', missionId, reason })
        }

        result.fundedCents = await this.fundTranche(mission)
        result.claimTxHash = (await this.claimIfDue(mission, now))?.txHash
      } catch (error) {
        result.error = messageOf(error)
        this.logger({ level: 'error', msg: 'fund flow step failed', missionId, detail: result.error })
      }
      return result
    })
  }
}

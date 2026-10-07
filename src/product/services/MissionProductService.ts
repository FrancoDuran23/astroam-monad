import type { ConnectivityProvider } from '../../providers/connectivity/ConnectivityProvider.ts'
import type { MissionRepository } from '../persistence/MissionRepository.ts'
import type { Capabilities, ClaimRecord, DestinationInfo, ProductMission, PublicEsimInfo } from '../types/mission.ts'
import { IntegratedMeterService } from '../../meter/meter-service.ts'
import { computeCostRaw, type ChannelBalancePort } from '../../services/PolicyEnforcer.ts'
import { createConnectivitySession, type ConnectivitySession } from '../../models/ConnectivitySession.ts'
import { runReconciliation } from '../../jobs/reconciliation.ts'
import { parseNonNegativeIntegerRaw, pricePerMibFromPerMbRaw } from '../../shared/money.ts'
import type { PaymentRail } from '../../rails/PaymentRail.ts'
import { assertSufficientResellerBalance } from '../../services/reseller-balance-guard.ts'
import { createChannelMutex } from '../../shared/mutex.ts'
import { equivalentBytes } from '../../shared/usage-math.ts'
import { atomicToRaw, rawToAtomicCeil, rawToAtomicFloor, formatAtomic, usdcToAtomic } from '../../shared/monad/amounts.ts'
import {
  claimIsDue,
  nextFundCents,
  autoCloseReason,
  type FundFlowConfig,
  type AutoCloseReason,
  DEFAULT_FUND_FLOW,
  DEFAULT_TIMEOUT_SECONDS,
} from './fund-flow.ts'
import { isWildcardOrigin } from '../api/cors.ts'

const FUND_TOLERANCE_CENTS = 1
const MICRO_USD_PER_CENT = 10_000n

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  connectivity: ConnectivityProvider
  /** How missions are paid: a real chain, or FakeRail for demos. */
  rail: PaymentRail
  hasCitrusReal?: boolean
  fundFlow?: FundFlowConfig
  timeoutSeconds?: number
  logger?: (line: Record<string, unknown>) => void
}

export class MissionProductService {
  private repo: MissionRepository
  private connectivity: ConnectivityProvider
  private rail: PaymentRail
  private hasCitrusReal: boolean
  private fundFlow: FundFlowConfig
  private timeoutSeconds: number
  private logger: (line: Record<string, unknown>) => void
  private locks = createChannelMutex()

  // Active sessions & meter services per mission
  private sessions = new Map<string, ConnectivitySession>()
  private meters = new Map<string, IntegratedMeterService>()

  constructor(options: MissionProductServiceOptions) {
    this.repo = options.repo
    this.connectivity = options.connectivity
    this.rail = options.rail
    this.hasCitrusReal = options.hasCitrusReal ?? false
    this.fundFlow = options.fundFlow ?? DEFAULT_FUND_FLOW
    this.timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
    this.logger = options.logger ?? ((line) => console.log(JSON.stringify(line)))
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
    const railReady = this.rail.isLive
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
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

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

    const result = await this.rail.confirmDeposit({ missionId, intentId, txHash, purpose: 'mission' })
    if (!result.valid) {
      mission.paymentStatus = 'failed'
      await this.repo.save(mission)
      throw new Error(`Deposit for intent ${intentId} was not accepted: ${result.reason}`)
    }

    mission.paymentStatus = 'paid'
    mission.status = 'paid'
    mission.depositTxHash = result.txHash
    mission.depositExplorerUrl = result.explorerUrl
    mission.channelId = result.channelId
    mission.escrowId = result.channelId
    mission.depositAtomic = rawToAtomicCeil(result.depositRaw).toString()
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

    // First tranche. A failure here does not undo the activation: the fund-flow job retries.
    try {
      await this.locks.withChannelLock(mission.id, async () => this.fundTranche(await this.load(mission.id)))
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
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.hasCitrusReal) {
      throw unavailable('Citrus Mobile is not configured for live mode')
    }

    if (mission.iccid) await this.connectivity.suspend(mission.iccid)

    mission.esimStatus = 'paused'
    mission.status = 'paused'
    if (mission.esim) mission.esim.status = 'suspended'
    await this.repo.save(mission)

    return { status: 'paused', esimStatus: 'paused' }
  }

  async resumeMission(missionId: string) {
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.hasCitrusReal) {
      throw unavailable('Citrus Mobile is not configured for live mode')
    }

    if (mission.iccid) await this.connectivity.resume(mission.iccid)

    mission.esimStatus = 'active'
    mission.status = 'active'
    if (mission.esim) mission.esim.status = 'active'
    await this.repo.save(mission)

    return { status: 'active', esimStatus: 'active' }
  }

  async createTopUpIntent(missionId: string, amountUsdc: number) {
    const mission = await this.load(missionId)
    if (!mission.channelId) throw new Error('This mission has no payment channel yet')
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

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
    const mission = await this.load(missionId)

    const topup = mission.topups.find((t) => t.intentId === intentId)
    if (!topup) throw new Error(`Top-up for intent ${intentId} not found`)
    if (topup.status === 'settled' && topup.txHash) {
      return { valid: true, status: 'settled', txHash: topup.txHash, explorerUrl: topup.explorerUrl }
    }
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    const result = await this.rail.confirmDeposit({
      missionId,
      intentId,
      txHash,
      purpose: 'topup',
      channelId: mission.channelId,
    })
    if (!result.valid) throw new Error(`Top-up was not accepted: ${result.reason}`)

    if (mission.iccid) {
      try {
        const amountCents = Math.max(1, Math.round(topup.amountUsdc * 100))
        await this.connectivity.topUp(mission.iccid, amountCents)
      } catch {
        // The eSIM wallet catches up on the next funding pass.
      }
    }

    topup.status = 'settled'
    topup.txHash = result.txHash
    topup.explorerUrl = result.explorerUrl
    mission.balanceUsdc += topup.amountUsdc
    mission.budgetUsdc += topup.amountUsdc
    if (mission.status === 'paused' && mission.balanceUsdc > 0) {
      mission.status = 'active'
      mission.esimStatus = 'active'
    }

    await this.repo.save(mission)
    return {
      valid: true,
      status: 'settled',
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      balanceUsdc: mission.balanceUsdc,
    }
  }

  async finishMission(missionId: string) {
    const mission = await this.load(missionId)
    if (!mission.channelId) throw new Error('This mission has no payment channel to close')
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    // Settle exactly what was used, in integer raw units (never a float).
    const pricePerMbRaw = envRaw('PRICE_PER_MB_RAW') ?? usdcToRaw(mission.destination.pricePerMbUsdc)
    const usedRaw = computeCostRaw(BigInt(mission.meteredBytes || '0'), pricePerMbRaw)
    const outcome = await this.rail.closeChannel(mission.channelId, usedRaw)
    if (outcome.kind === 'failed' || outcome.kind === 'blocked') {
      throw new Error(`Could not close the payment channel: ${outcome.detail}`)
    }

    if (mission.iccid) {
      try {
        await this.connectivity.refundUnused(mission.iccid)
      } catch {
        // The eSIM wallet is reconciled by the session closer.
      }
    }

    mission.status = 'completed'
    mission.esimStatus = 'disabled'
    if (outcome.kind === 'nothing_to_close') {
      mission.settledUsdc = 0
      mission.refundedUsdc = mission.budgetUsdc
    } else {
      mission.closeTxHash = outcome.txHash
      mission.closeExplorerUrl = outcome.explorerUrl
      mission.settledUsdc = rawToUsdc(outcome.settledRaw)
      if (outcome.kind === 'closed') mission.refundedUsdc = rawToUsdc(outcome.refundedRaw)
    }
    await this.repo.save(mission)

    return {
      status: 'completed',
      closeKind: outcome.kind,
      txHash: mission.closeTxHash,
      explorerUrl: mission.closeExplorerUrl,
      settledUsdc: mission.settledUsdc,
      refundedUsdc: mission.refundedUsdc,
    }
  }

  /**
   * Gives the whole deposit back for a trip that was paid but never started
   * (no eSIM, no usage). The rail closes the channel with nothing to settle.
   */
  async cancelMission(missionId: string) {
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

    if (result.actionApplied.kind === 'suspend' || mission.balanceUsdc <= 0) {
      mission.status = 'paused'
      mission.esimStatus = 'paused'
    }

    await this.repo.save(mission)

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
    const priceAtomic = usdcToAtomic(mission.destination.pricePerMbUsdc)
    const meteredAtomic = (BigInt(mission.meteredBytes || '0') * priceAtomic) / 1_000_000n
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

  /** The app sends a cumulative voucher after a usage reading. Funds the next tranche when it covers one. */
  async submitVoucher(missionId: string, voucher: { cumulativeAtomic: string; signature: string }) {
    return this.locks.withChannelLock(missionId, async () => {
      const mission = await this.load(missionId)
      const isNew = await this.acceptVoucher(mission, voucher)
      if (isNew) await this.repo.save(mission)
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
    }
  }

  /** Sends a `claim` when the voucher holds a tranche not collected yet. */
  private async claimIfDue(mission: ProductMission, now: Date): Promise<ClaimRecord | null> {
    if (!this.rail.claim || !mission.depositVerified || !mission.channelId || !mission.voucher) return null
    const voucherAtomic = BigInt(mission.voucher.cumulativeAtomic)
    if (!claimIsDue(voucherAtomic, BigInt(mission.claimedAtomic ?? '0'), this.fundFlow)) return null

    let txHash: string
    try {
      const claimRes = await this.rail.claim({
        channelId: mission.channelId,
        voucherAmountAtomic: voucherAtomic,
        signature: mission.voucher.signature,
      })
      txHash = claimRes.txHash
    } catch (error) {
      if (this.rail.readEscrowState) {
        const state = await this.rail.readEscrowState(mission.channelId)
        if (state && state.claimedAtomic >= voucherAtomic) {
          mission.claimedAtomic = state.claimedAtomic.toString()
          if (state.activeAt) mission.escrowActiveAt = new Date(state.activeAt * 1000).toISOString()
          await this.repo.save(mission)
          return null
        }
      }
      throw error
    }
    const record: ClaimRecord = {
      txHash,
      explorerUrl: this.rail.explorerTxUrl(txHash) ?? undefined,
      cumulativeAtomic: voucherAtomic.toString(),
      at: now.toISOString(),
      claimedAt: now.toISOString(),
    }
    mission.claimedAtomic = voucherAtomic.toString()
    mission.claims = [...(mission.claims ?? []), record]
    // A claim restarts the escrow's refund timeout.
    mission.escrowActiveAt = record.at
    await this.repo.save(mission)
    this.logger({ level: 'info', msg: 'escrow claim', missionId: mission.id, txHash, cumulativeAtomic: record.cumulativeAtomic })
    return record
  }

  /** Closes the escrow with the highest voucher: the rest is paid and the traveler is refunded. */
  private async closeWithVoucher(mission: ProductMission, reason?: AutoCloseReason) {
    if (!mission.channelId || !mission.voucher) {
      throw new Error('There is no signed voucher to close this trip with')
    }
    if (mission.iccid) {
      try {
        await this.connectivity.refundUnused(mission.iccid)
      } catch {
        // The eSIM wallet goes back to the reseller balance later; the USDC refund does not wait for it.
      }
    }

    const priceAtomic = usdcToAtomic(mission.destination.pricePerMbUsdc)
    const meteredAtomic = (BigInt(mission.meteredBytes || '0') * priceAtomic) / 1_000_000n
    const voucherAtomic = BigInt(mission.voucher.cumulativeAtomic)
    const settleAtomic = meteredAtomic > voucherAtomic ? voucherAtomic : meteredAtomic

    const outcome = await this.rail.closeChannel(
      mission.channelId,
      atomicToRaw(settleAtomic),
    )
    if (outcome.kind === 'failed') {
      if (this.rail.readEscrowState) {
        const state = await this.rail.readEscrowState(mission.channelId)
        if (!state?.settled) {
          throw new Error(`Could not close channel: ${outcome.detail}`)
        }
      } else if (!outcome.detail.includes('already settled') && !outcome.detail.includes('already closed')) {
        throw new Error(`Could not close channel: ${outcome.detail}`)
      }
    }

    const settled =
      (outcome.kind === 'closed' || outcome.kind === 'closed_unverified') && outcome.settledRaw !== undefined
        ? rawToAtomicFloor(outcome.settledRaw)
        : settleAtomic
    const deposit = BigInt(mission.depositAtomic ?? '0')
    mission.status = 'completed'
    mission.esimStatus = 'disabled'
    mission.settlement = 'close'
    mission.settledUsdc = Number(formatAtomic(settled))
    mission.refundedUsdc = Number(formatAtomic(deposit > settled ? deposit - settled : 0n))
    mission.claimedAtomic = settled.toString()
    if (outcome.kind === 'closed' || outcome.kind === 'closed_unverified') {
      mission.closeTxHash = outcome.txHash
      mission.closeExplorerUrl = outcome.explorerUrl
    }
    if (reason) mission.autoCloseReason = reason
    await this.repo.save(mission)
    this.logger({ level: 'info', msg: 'escrow close', missionId: mission.id, txHash: mission.closeTxHash, reason: reason ?? 'traveler' })
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

        const reason = autoCloseReason(mission, this.fundFlow, now, this.timeoutSeconds)
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

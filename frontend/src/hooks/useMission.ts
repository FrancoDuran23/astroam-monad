import { useCallback, useEffect, useState } from 'react'
import { envConfig } from '../config/env'
import { demoMissionService } from '../services/DemoMissionService'
import { apiMissionService } from '../services/ApiMissionService'
import { DEMO_TRAFFIC_MB } from '../utils/missionUtils'
import type {
  BackendCapabilities,
  FinishResult,
  Mission,
  PaymentConfirmationResult,
  PaymentIntentInfo,
  UsageEvent,
  WizardData,
} from '../types/mission'

export function useMission() {
  const [mission, setMission] = useState<Mission | null>(null)
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [caps, setCaps] = useState<BackendCapabilities | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<boolean>(false)
  /** USDC the traveler's app has authorized AstroAm to charge (Monad). */
  const [authorizedUsdc, setAuthorizedUsdc] = useState<number | null>(null)

  const isDemoMode = envConfig.mode === 'demo'

  const loadBackendState = useCallback(async () => {
    setLoading(true)
    setBackendError(null)

    if (isDemoMode) {
      const state = demoMissionService.loadState()
      setMission(state.mission)
      setEvents(state.events)
      setLoading(false)
      return
    }

    // API Mode
    try {
      const capabilities = await apiMissionService.fetchCapabilities()
      setCaps(capabilities)

      if (!capabilities || !capabilities.backendAvailable) {
        setBackendError('The AstroAm server is not responding.')
        setLoading(false)
        return
      }

      const savedId = apiMissionService.getSavedMissionId()
      if (savedId) {
        try {
          const freshMission = await apiMissionService.getMission(savedId)
          setMission(freshMission)
          try {
            const usage = await apiMissionService.getUsage(savedId)
            if (usage) {
              setMission((prev) =>
                prev
                  ? {
                      ...prev,
                      carrierBytes: usage.carrierBytes,
                      meteredBytes: usage.meteredBytes,
                    }
                  : null,
              )
            }
          } catch {
            // Usage poll fail non-fatal
          }
        } catch {
          // Saved mission not found on server
          apiMissionService.clearSavedMissionId()
          setMission(null)
        }
      }
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : 'Could not reach the API')
    } finally {
      setLoading(false)
    }
  }, [isDemoMode])

  useEffect(() => {
    void loadBackendState()
  }, [loadBackendState])

  // Polling in API Mode when mission is active
  useEffect(() => {
    if (isDemoMode || !mission || !mission.id) return

    const interval = setInterval(async () => {
      try {
        const fresh = await apiMissionService.getMission(mission.id)
        const usage = await apiMissionService.getUsage(mission.id)
        const meteredBytes = Number(usage.meteredBytes) || 0
        setMission({
          ...fresh,
          consumedMb: meteredBytes > 0 ? Math.round((meteredBytes / (1024 * 1024)) * 100) / 100 : fresh.consumedMb,
        })
      } catch {
        // Polling error non-fatal
      }
    }, 8000)

    return () => clearInterval(interval)
  }, [isDemoMode, mission?.id])

  const createMission = async (data: WizardData): Promise<Mission> => {
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const newMission = await demoMissionService.createMission(data)
        setMission(newMission)
        setEvents([])
        return newMission
      } else {
        const newMission = await apiMissionService.createMission(data)
        setMission(newMission)
        return newMission
      }
    } finally {
      setActionLoading(false)
    }
  }

  // `target`: la misión recién creada. El estado `mission` de este render
  // todavía no la tiene cuando se llama justo después de createMission.
  const createPaymentIntent = async (target?: Mission): Promise<PaymentIntentInfo> => {
    const current = target ?? mission
    if (!current) throw new Error('No active mission')
    if (isDemoMode) {
      return {
        intentId: `intent_demo_${Date.now()}`,
        amount: current.budgetUsdc.toString(),
        asset: 'USDC',
        status: 'pending',
        isMock: true,
      }
    }
    return apiMissionService.createPaymentIntent(current.id)
  }

  const confirmPayment = async (intentId: string, txHash: string): Promise<PaymentConfirmationResult> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const updated: Mission = { ...mission, paymentStatus: 'paid', status: 'paid', depositTxHash: txHash }
        setMission(updated)
        demoMissionService.saveState({ mission: updated, events })
        return { valid: true, status: 'paid', depositTxHash: txHash }
      }
      const res = await apiMissionService.confirmPayment(mission.id, intentId, txHash)
      if (res.valid) {
        const fresh = await apiMissionService.getMission(mission.id)
        setMission(fresh)
      }
      return res
    } finally {
      setActionLoading(false)
    }
  }

  const activate = async (): Promise<void> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const updated: Mission = { ...mission, status: 'active', esimStatus: 'active' }
        setMission(updated)
        demoMissionService.saveState({ mission: updated, events })
        return
      }
      const res = await apiMissionService.activateMission(mission.id)
      const fresh = await apiMissionService.getMission(mission.id)
      setMission({
        ...fresh,
        esim: res.esim || fresh.esim,
        isMock: res.isMock ?? fresh.isMock,
      })
    } finally {
      setActionLoading(false)
    }
  }

  const createTopUpIntent = async (amountUsdc: number): Promise<PaymentIntentInfo> => {
    if (!mission) throw new Error('No active mission')
    if (isDemoMode) {
      return {
        intentId: `top_intent_${Date.now()}`,
        amount: amountUsdc.toString(),
        asset: 'USDC',
        status: 'pending',
        isMock: true,
      }
    }
    return apiMissionService.createTopUpIntent(mission.id, amountUsdc)
  }

  const confirmTopUpPayment = async (intentId: string, txHash: string, amountUsdc: number): Promise<void> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const newState = demoMissionService.topUp({ mission, events }, amountUsdc)
        setMission(newState.mission)
        setEvents(newState.events)
        return
      }
      await apiMissionService.confirmTopUpPayment(mission.id, intentId, txHash)
      const fresh = await apiMissionService.getMission(mission.id)
      setMission(fresh)
    } finally {
      setActionLoading(false)
    }
  }

  const togglePause = async (): Promise<void> => {
    if (!mission) return
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const newState = demoMissionService.togglePause({ mission, events })
        setMission(newState.mission)
        setEvents(newState.events)
        return
      }
      const isPaused = mission.esimStatus === 'paused'
      if (isPaused) {
        await apiMissionService.resumeMission(mission.id)
      } else {
        await apiMissionService.pauseMission(mission.id)
      }
      const fresh = await apiMissionService.getMission(mission.id)
      setMission(fresh)
    } finally {
      setActionLoading(false)
    }
  }

  const finish = async (): Promise<FinishResult> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const newState = demoMissionService.completeMission({ mission, events })
        setMission(newState.mission)
        setEvents(newState.events)
        return {
          status: 'completed',
          txHash: `demo_close_${Date.now().toString(16)}`,
          settledUsdc: mission.consumedUsdc,
          refundedUsdc: mission.balanceUsdc,
        }
      }
      // Authorize everything used so far, so the close can settle all of it.
      if (travelerSigns) await authorizeUpTo(mission.consumedUsdc ?? 0)
      const res = await apiMissionService.finishMission(mission.id)
      const fresh = await apiMissionService.getMission(mission.id)
      setMission(fresh)
      return res
    } finally {
      setActionLoading(false)
    }
  }

  const travelerSigns = !isDemoMode && caps?.voucherSigning === 'traveler'

  useEffect(() => {
    if (!travelerSigns || !mission?.id || !mission.channelId) return
    apiMissionService
      .getAuthorization(mission.id)
      .then((a) => setAuthorizedUsdc(a.authorizedUsdc))
      .catch(() => undefined)
  }, [travelerSigns, mission?.id, mission?.channelId])

  /**
   * Monad: the app signs a voucher with its session key so AstroAm can charge
   * up to `targetUsdc` (capped at the deposit). Signed ahead of usage, so data
   * keeps flowing; whatever is not used is refunded at close.
   */
  const authorizeUpTo = async (targetUsdc: number): Promise<void> => {
    if (!travelerSigns || !mission) return
    // viem loads only when a Monad trip needs it.
    const { hasSessionKey, recordAuthorization, signAuthorization } = await import('../chain/monad')
    if (!hasSessionKey(mission.id)) {
      throw new Error('This browser does not hold the session key for this trip, so it cannot authorize more usage.')
    }
    const voucher = await signAuthorization(mission.id, Math.min(targetUsdc, mission.budgetUsdc))
    if (!voucher) return
    const res = await apiMissionService.submitAuthorization(mission.id, voucher.cumulativeAmount, voucher.signature)
    recordAuthorization(mission.id, voucher.cumulativeAmount)
    setAuthorizedUsdc(res.authorizedUsdc)
  }

  const simulate = async (): Promise<void> => {
    if (!mission) return
    if (travelerSigns) {
      // Authorize the next batch plus a small margin before it flows.
      const batchUsdc = DEMO_TRAFFIC_MB * mission.destination.pricePerMbUsdc
      await authorizeUpTo((mission.consumedUsdc ?? 0) + batchUsdc * 1.1 + 0.01)
    }
    if (isDemoMode) {
      const newState = demoMissionService.simulateConsumption({ mission, events })
      setMission(newState.mission)
      setEvents(newState.events)
    } else {
      const res = (await apiMissionService.triggerDemoTraffic(mission.id, DEMO_TRAFFIC_MB * 1_000_000)) as {
        voucher?: { kind: string; envelope?: { voucher?: { signature?: string } } }
        consumedUsdc?: number
      }
      const fresh = await apiMissionService.getMission(mission.id)
      const signed = res.voucher?.kind === 'signed'
      const event: UsageEvent = {
        id: `${Date.now()}`,
        timestamp: new Date().toISOString(),
        kind: 'usage',
        mb: DEMO_TRAFFIC_MB,
        amountUsdc: Math.max(0, (fresh.consumedUsdc ?? 0) - (mission.consumedUsdc ?? 0)),
        status: signed ? 'signed' : 'rejected',
        txId: res.voucher?.envelope?.voucher?.signature ?? '',
      }
      setEvents((prev) => [event, ...prev])
      setMission(fresh)
    }
  }

  const reset = (): void => {
    if (isDemoMode) {
      demoMissionService.resetDemo()
    } else {
      apiMissionService.clearSavedMissionId()
    }
    setMission(null)
    setEvents([])
  }

  return {
    mission,
    events,
    caps,
    loading,
    actionLoading,
    backendError,
    isDemoMode,
    travelerSigns,
    authorizedUsdc,
    retryBackend: loadBackendState,
    createMission,
    createPaymentIntent,
    confirmPayment,
    activate,
    createTopUpIntent,
    confirmTopUpPayment,
    togglePause,
    finish,
    simulate,
    reset,
  }
}

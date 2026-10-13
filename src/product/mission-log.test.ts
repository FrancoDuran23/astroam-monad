// The per-mission log: which events a full trip records, that it never holds a
// secret, that a failing log never fails the trip, and the route that serves it.

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import { createProductRouter } from './api/routes.ts'
import { MissionProductService } from './services/MissionProductService.ts'
import { MemoryMissionLog, type MissionLog, type MissionLogEntry } from './persistence/MissionLog.ts'
import type { MissionRepository } from './persistence/MissionRepository.ts'
import type { ProductMission } from './types/mission.ts'
import { FakeProvider } from '../providers/connectivity/FakeProvider.ts'
import { FakeRail } from '../rails/FakeRail.ts'

class MemoryRepo implements MissionRepository {
  private store = new Map<string, ProductMission>()
  async save(mission: ProductMission): Promise<void> {
    this.store.set(mission.id, structuredClone(mission))
  }
  async findById(id: string): Promise<ProductMission | null> {
    const mission = this.store.get(id)
    return mission ? structuredClone(mission) : null
  }
  async findByPaymentIntentId(): Promise<ProductMission | null> {
    return null
  }
  async findAll(): Promise<ProductMission[]> {
    return Array.from(this.store.values(), (mission) => structuredClone(mission))
  }
}

const BRASIL = { id: 'br', name: 'Brasil', flag: 'BR', network: 'Vivo', coverage: '4G/5G', pricePerMbUsdc: 0.0025 }
const MB = 1_000_000
const API_KEY = 'citrus_test_key_9f8e7d6c5b4a'

let service: MissionProductService
let provider: FakeProvider
let rail: FakeRail
let log: MissionLog
let clock: Date
let lines: Record<string, unknown>[]
const savedEnv: Record<string, string | undefined> = {}

before(() => {
  for (const key of ['ENABLE_DEMO_TRAFFIC', 'ASTROAM_LIVE_ENABLED', 'ASTROAM_DEMO_ACCESS_TOKEN', 'CITRUS_API_KEY', 'PRICE_PER_MB_RAW']) {
    savedEnv[key] = process.env[key]
  }
  process.env.ENABLE_DEMO_TRAFFIC = 'true'
  process.env.CITRUS_API_KEY = API_KEY
  delete process.env.ASTROAM_LIVE_ENABLED
  delete process.env.ASTROAM_DEMO_ACCESS_TOKEN
  delete process.env.PRICE_PER_MB_RAW
})

after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function boot(missionLog: MissionLog) {
  clock = new Date('2026-10-05T12:00:00Z')
  provider = new FakeProvider()
  rail = new FakeRail({ now: () => clock })
  lines = []
  service = new MissionProductService({
    repo: new MemoryRepo(),
    missionLog,
    connectivity: provider,
    rail,
    timeoutSeconds: 7 * 24 * 3600,
    logger: (line) => lines.push(line),
  })
}

beforeEach(() => {
  log = new MemoryMissionLog()
  boot(log)
})

let travelers = 0

async function paidTrip() {
  const created = await service.createMission({
    userId: `usr_${++travelers}`,
    destination: BRASIL,
    startDate: '2026-10-05',
    endDate: '2026-10-12',
    budgetUsdc: 10,
    dailyLimitUsdc: 10,
  })
  const intent = await service.createPaymentIntent(created.id)
  await service.confirmPayment(created.id, intent.intentId, `0xdeposit_${created.id}`)
  const mission = await service.getMission(created.id)
  return { id: created.id, escrowId: mission.escrowId! }
}

/** Every step a trip goes through, in the order a real one does. */
async function fullFlow() {
  const trip = await paidTrip()
  const activated = await service.activateMission(trip.id)
  await service.pauseMission(trip.id)
  await service.resumeMission(trip.id)
  await service.processDemoTraffic(trip.id, 400 * MB)

  // The app signs for 6 USDC; the provider has charged $4, which is 6 USDC at the 1.5x markup.
  const signature = await rail.signVoucher(trip.escrowId, 6_000_000n)
  await service.submitVoucher(trip.id, { cumulativeAtomic: '6000000', signature })
  provider.setChargedUsd(activated.esim.iccid, 4_000_000n)
  const pass = await service.advance(trip.id, clock)
  assert.ok(pass.claimTxHash)
  assert.equal(pass.error, undefined)

  const finished = await service.finishMission(trip.id)
  return { trip, activated, signature, claimTxHash: pass.claimTxHash, finished }
}

test('a full trip records its events in order', async () => {
  const { trip, activated, claimTxHash, finished } = await fullFlow()

  const entries = await service.getMissionLog(trip.id)
  assert.deepEqual(
    entries.map((entry) => entry.type),
    [
      'esim.provisioned',
      'usage.baseline',
      'esim.funded',
      'esim.paused',
      'esim.resumed',
      'usage.demo_traffic',
      'voucher.received',
      'esim.funded',
      'usage.reading',
      'escrow.claim',
      'mission.closed',
    ],
  )
  assert.ok(entries.every((entry) => entry.v === 1 && entry.missionId === trip.id && entry.iccid === activated.esim.iccid))
  const times = entries.map((entry) => Date.parse(entry.at))
  assert.deepEqual(times, [...times].sort((a, b) => a - b))

  const byType = (type: MissionLogEntry['type']) => entries.filter((entry) => entry.type === type)
  assert.equal(byType('voucher.received')[0]!.data.cumulativeAtomic, '6000000')
  assert.equal(byType('usage.reading')[0]!.data.meteredBytes, '2400000000')
  assert.equal(byType('escrow.claim')[0]!.data.txHash, claimTxHash)
  assert.equal(byType('escrow.claim')[0]!.data.cumulativeAtomic, '6000000')
  const closed = byType('mission.closed')[0]!
  assert.equal(closed.data.txHash, finished.txHash)
  assert.equal(closed.data.settledUsdc, 6)
  assert.equal(closed.data.refundedUsdc, 4)
})

test('finishing a finished trip adds nothing to the log', async () => {
  const { trip } = await fullFlow()
  const count = (await service.getMissionLog(trip.id)).length

  await service.finishMission(trip.id)
  assert.equal((await service.getMissionLog(trip.id)).length, count)
})

test('a close that fails records no close, and the retry records it once', async () => {
  const trip = await paidTrip()
  await service.activateMission(trip.id)
  await service.processDemoTraffic(trip.id, 400 * MB)
  const closeChannel = rail.closeChannel.bind(rail)
  rail.closeChannel = async () => {
    rail.closeChannel = closeChannel
    return { kind: 'failed', reason: 'upstream_unavailable', detail: 'rpc unreachable' }
  }

  await assert.rejects(() => service.finishMission(trip.id))
  assert.equal((await service.getMissionLog(trip.id)).filter((entry) => entry.type === 'mission.closed').length, 0)
  await service.finishMission(trip.id)
  assert.equal((await service.getMissionLog(trip.id)).filter((entry) => entry.type === 'mission.closed').length, 1)
})

test('a cancelled trip records the refund', async () => {
  const trip = await paidTrip()
  await service.cancelMission(trip.id)

  const entries = await service.getMissionLog(trip.id)
  assert.deepEqual(entries.map((entry) => entry.type), ['mission.closed'])
  assert.equal(entries[0]!.data.closeKind, 'cancelled')
  assert.equal(entries[0]!.data.refundedUsdc, 10)
  assert.equal(entries[0]!.iccid, null)
})

test('no entry holds a signature, a key, the activation code or the API key', async () => {
  const { trip, signature } = await fullFlow()
  const mission = await service.getMission(trip.id)
  const entries = await service.getMissionLog(trip.id)
  const text = JSON.stringify(entries)

  // The secrets this flow actually produced, not just names that look sensitive.
  const secrets = {
    voucher_signature: signature,
    stored_voucher_signature: mission.voucher?.signature,
    session_key: mission.sessionKey,
    activation_code: mission.esim?.lpaString,
    qr_code: mission.esim?.qrCode,
    install_url: mission.esim?.directInstallUrl,
    api_key: API_KEY,
  }
  for (const [name, value] of Object.entries(secrets)) {
    assert.ok(value && value.length >= 8, `the flow produced no ${name} to look for`)
    assert.equal(text.includes(value), false, `${name} is in the log`)
    // Also its raw hex or payload part, in case a prefix is added or removed.
    const bare = value.replace(/^0x/, '').slice(0, 24)
    assert.equal(text.toLowerCase().includes(bare.toLowerCase()), false, `part of ${name} is in the log`)
  }
  assert.equal(/lpa:|signature|sessionkey|apikey|privatekey|secret/i.test(text), false)
  // What the log may carry is there: amounts and transaction hashes.
  assert.ok(entries.some((entry) => typeof entry.data.txHash === 'string'))
})

test('a log that cannot be written never fails the trip, and is reported', async () => {
  boot({
    append() {
      throw new Error('disk full')
    },
    async list() {
      return []
    },
  })

  const trip = await paidTrip()
  const activated = await service.activateMission(trip.id)
  assert.equal(activated.status, 'active')
  await service.processDemoTraffic(trip.id, 400 * MB)
  const finished = await service.finishMission(trip.id)

  assert.equal(finished.status, 'completed')
  const unwritten = lines.filter((line) => line.msg === 'mission log not written')
  assert.ok(unwritten.length >= 3)
  assert.ok(unwritten.every((line) => line.level === 'error' && line.detail === 'disk full'))
})

test('the log of an unknown trip is an error', async () => {
  await assert.rejects(() => service.getMissionLog('mis_unknown'), /not found/)
})

// --- the route ---------------------------------------------------------

let server: http.Server
let baseUrl: string

before(async () => {
  const app = express()
  app.use(express.json())
  // The service is rebuilt for every test: the router always talks to the current one.
  const current = new Proxy({}, { get: (_, key) => (service as never)[key] }) as MissionProductService
  app.use('/api', createProductRouter(current))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      resolve()
    })
  })
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('GET /api/missions/:id/logs returns the entries, oldest first', async () => {
  const { trip } = await fullFlow()

  const res = await fetch(`${baseUrl}/api/missions/${trip.id}/logs`)

  assert.equal(res.status, 200)
  const body = (await res.json()) as { missionId: string; entries: MissionLogEntry[] }
  assert.equal(body.missionId, trip.id)
  assert.equal(body.entries[0]!.type, 'esim.provisioned')
  assert.equal(body.entries.at(-1)!.type, 'mission.closed')
  assert.equal(body.entries.length, 11)
})

test('GET /api/missions/:id/logs is 404 for an unknown trip', async () => {
  const res = await fetch(`${baseUrl}/api/missions/mis_unknown/logs`)

  assert.equal(res.status, 404)
  assert.equal(((await res.json()) as { error: string }).error, 'not_found')
})

test('the log is open exactly like the mission, also in live mode with an access token', async () => {
  const trip = await paidTrip()
  process.env.ASTROAM_LIVE_ENABLED = 'true'
  process.env.ASTROAM_DEMO_ACCESS_TOKEN = 'a_secret_token'
  process.env.FRONTEND_ORIGIN = 'https://app.example'
  try {
    const mission = await fetch(`${baseUrl}/api/missions/${trip.id}`)
    const logs = await fetch(`${baseUrl}/api/missions/${trip.id}/logs`)
    assert.equal(mission.status, 200)
    assert.equal(logs.status, mission.status)
  } finally {
    delete process.env.ASTROAM_LIVE_ENABLED
    delete process.env.ASTROAM_DEMO_ACCESS_TOKEN
    delete process.env.FRONTEND_ORIGIN
  }
})

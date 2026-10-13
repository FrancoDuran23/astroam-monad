// Demo flow with no real services (FakeProvider + a simulated payment agent
// per mission), as `npm run server` starts it with .env.example.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { MissionProductService } from './services/MissionProductService.ts'
import type { MissionRepository } from './persistence/MissionRepository.ts'
import type { ProductMission } from './types/mission.ts'
import { FakeRail } from '../rails/FakeRail.ts'
import { FakeProvider } from '../providers/connectivity/FakeProvider.ts'
import { escrowIdForMission } from '../shared/monad/voucher.ts'

class MemoryRepo implements MissionRepository {
  private store = new Map<string, ProductMission>()

  async save(mission: ProductMission): Promise<void> {
    this.store.set(mission.id, structuredClone(mission))
  }

  async findById(id: string): Promise<ProductMission | null> {
    const mission = this.store.get(id)
    return mission ? structuredClone(mission) : null
  }

  async findByPaymentIntentId(intentId: string): Promise<ProductMission | null> {
    for (const m of this.store.values()) {
      if (m.paymentIntentId === intentId) return structuredClone(m)
    }
    return null
  }

  async findAll(): Promise<ProductMission[]> {
    return Array.from(this.store.values(), (m) => structuredClone(m))
  }
}

const BRASIL = {
  id: 'br',
  name: 'Brasil',
  flag: 'BR',
  network: 'Vivo',
  coverage: '4G/5G',
  pricePerMbUsdc: 0.0025,
}

let service: MissionProductService

before(() => {
  process.env.ENABLE_DEMO_TRAFFIC = 'true'
  delete process.env.ASTROAM_LIVE_ENABLED
  delete process.env.PRICE_PER_MB_RAW
  delete process.env.PRICE_PER_MIB_RAW
  delete process.env.CHANNEL_CONTRACT

  service = new MissionProductService({
    repo: new MemoryRepo(),
    connectivity: new FakeProvider(),
    rail: new FakeRail(),
  })
})

async function activeMission(budgetUsdc: number): Promise<string> {
  const { id } = await service.createMission({
    destination: BRASIL,
    startDate: '2026-10-01',
    endDate: '2026-10-04',
    budgetUsdc,
    dailyLimitUsdc: budgetUsdc,
  })
  const intent = await service.createPaymentIntent(id)
  // One transaction per mission: a hash names a single deposit.
  await service.confirmPayment(id, intent.intentId, `demo_tx_${id}`)
  await service.activateMission(id)
  return id
}

test('the deposit opens a payment channel for the mission', async () => {
  const id = await activeMission(5)
  const mission = await service.getMission(id)
  // The mission's own escrow id, as on chain.
  assert.equal(mission.channelId, escrowIdForMission(id))
})

test('demo traffic signs vouchers and charges the destination rate, without pausing early', async () => {
  const id = await activeMission(5) // 5 USDC at 0.0025 USDC/MB = 2,000 MB

  const legs = [300, 700, 800]
  for (const mb of legs) {
    const res = await service.processDemoTraffic(id, mb * 1_000_000)
    assert.equal(res.voucher.kind, 'signed', `no signed voucher for the ${mb} MB leg`)
    assert.equal(res.status, 'active', `the mission paused on the ${mb} MB leg`)
  }

  const last = await service.processDemoTraffic(id, 600 * 1_000_000) // 2,400 MB > 2,000
  assert.equal(last.voucher.kind, 'unsigned')
  assert.equal(last.status, 'paused')
})

test('two missions do not overwrite each other vouchers', async () => {
  const a = await activeMission(5)
  const b = await activeMission(5)

  await service.processDemoTraffic(a, 1_000 * 1_000_000)
  const res = await service.processDemoTraffic(b, 300 * 1_000_000)
  assert.equal(res.voucher.kind, 'signed', 'the second mission should not see the voucher of the first')
})

test('the demo eSIM comes with a valid QR image', async () => {
  const id = await activeMission(5)
  const mission = await service.getMission(id)
  const qr = mission.esim?.qrCode ?? ''
  assert.match(qr, /^data:image\/svg\+xml;base64,/)
  assert.match(Buffer.from(qr.split(',')[1]!, 'base64').toString('utf8'), /^<svg /)
})

async function paidMission(budgetUsdc: number): Promise<string> {
  const { id } = await service.createMission({
    destination: BRASIL,
    startDate: '2026-10-01',
    endDate: '2026-10-04',
    budgetUsdc,
    dailyLimitUsdc: budgetUsdc,
  })
  const intent = await service.createPaymentIntent(id)
  await service.confirmPayment(id, intent.intentId, `demo_tx_${id}`)
  return id
}

test('cancelling a paid mission before activation refunds the whole deposit', async () => {
  const id = await paidMission(5)
  const res = await service.cancelMission(id)
  assert.equal(res.status, 'cancelled')
  assert.equal(res.refundedUsdc, 5)
  const mission = await service.getMission(id)
  assert.equal(mission.status, 'cancelled')
  assert.equal(mission.settledUsdc, 0)
})

test('cancelling twice is idempotent', async () => {
  const id = await paidMission(5)
  await service.cancelMission(id)
  const again = await service.cancelMission(id)
  assert.equal(again.status, 'cancelled')
  assert.equal(again.refundedUsdc, 5)
})

test('an already active mission cannot be cancelled: it is ended to settle what was used', async () => {
  const id = await activeMission(5)
  await assert.rejects(service.cancelMission(id), /already started/)
})

test('a mission without a confirmed deposit cannot be cancelled', async () => {
  const { id } = await service.createMission({
    destination: BRASIL,
    startDate: '2026-10-01',
    endDate: '2026-10-04',
    budgetUsdc: 5,
    dailyLimitUsdc: 5,
  })
  await assert.rejects(service.cancelMission(id), /Only a paid trip/)
})

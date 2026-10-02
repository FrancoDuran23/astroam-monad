import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MissionProductService } from "./services/MissionProductService.ts";
import type { MissionRepository } from "./persistence/MissionRepository.ts";
import type { ProductMission } from "./types/mission.ts";
import { CosmoPayService } from "../services/CosmoPayService.ts";
import { FakeProvider } from "../providers/connectivity/FakeProvider.ts";
import { createInMemoryVoucherPort } from "../meter/voucher-port.ts";
import { usdcToStellarRaw } from "../shared/monad/amounts.ts";

class MemoryRepo implements MissionRepository {
  private store = new Map<string, ProductMission>();

  async save(mission: ProductMission): Promise<void> {
    this.store.set(mission.id, structuredClone(mission));
  }

  async findById(id: string): Promise<ProductMission | null> {
    const mission = this.store.get(id);
    return mission ? structuredClone(mission) : null;
  }

  async findByPaymentIntentId(): Promise<ProductMission | null> {
    return null;
  }

  async findAll(): Promise<ProductMission[]> {
    return Array.from(this.store.values(), (mission) => structuredClone(mission));
  }
}

const BRASIL = {
  id: "br",
  name: "Brasil",
  flag: "BR",
  network: "Vivo",
  coverage: "4G/5G",
  pricePerMbUsdc: 0.0025,
};

let service: MissionProductService;

before(() => {
  process.env.ENABLE_DEMO_TRAFFIC = "true";
  delete process.env.ASTROAM_LIVE_ENABLED;
  delete process.env.MONAD_ESCROW_ADDRESS;
  service = new MissionProductService({
    repo: new MemoryRepo(),
    cosmoPay: new CosmoPayService(),
    connectivity: new FakeProvider(),
    createOfflineVoucherPort: (depositRaw) => createInMemoryVoucherPort({ depositRaw }),
  });
});

after(() => {
  delete process.env.MONAD_ESCROW_ADDRESS;
});

test("la misión cotiza el cierre en USDC de 6 decimales y no debita cada MB", async () => {
  const { id } = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-01",
    endDate: "2026-10-04",
    budgetUsdc: 5,
    dailyLimitUsdc: 5,
  });
  const intent = await service.createPaymentIntent(id);
  assert.equal(intent.rail, "monad");
  assert.equal(intent.monad.amount, "5000000");
  assert.equal(intent.monad.usdcDecimals, 6);
  assert.equal(intent.monad.chainId, 10143);
  assert.equal(intent.monad.usdc, "0x534b2f3A21130d7a60830c2Df862319e593943A3");
  assert.equal(intent.monad.deployed, false);

  await service.confirmPayment(id, intent.intentId, "0x" + "ab".repeat(32), "0x2222222222222222222222222222222222222222");
  await service.activateMission(id);

  // 1_000 MB at 0.0025 USDC = 2.5 USDC. One cumulative figure, not 1_000 debits.
  const traffic = await service.processDemoTraffic(id, 1_000 * 1_000_000);
  assert.equal(traffic.demoTraffic, true);
  assert.equal(traffic.voucher.kind, "signed");

  const close = await service.finishMission(id);
  assert.equal(close.status, "awaiting_close");
  assert.equal(close.monad.cumulativeAmount, "2500000");
  assert.equal(close.monad.refundAtomic, "2500000");
  assert.notEqual(close.monad.cumulativeAmount, usdcToStellarRaw(2.5).toString());
  assert.equal(close.monad.typedData, null);

  const mission = await service.getMission(id);
  assert.equal(mission.status, "active");
  assert.equal(mission.depositExplorerUrl, "https://testnet.monadvision.com/tx/" + "0x" + "ab".repeat(32));
});

test("con el escrow configurado el vale EIP-712 apunta a ese contrato", async () => {
  process.env.MONAD_ESCROW_ADDRESS = "0x3333333333333333333333333333333333333333";
  const { id } = await service.createMission({
    destination: BRASIL,
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    budgetUsdc: 1,
    dailyLimitUsdc: 1,
  });
  const close = await service.finishMission(id);
  assert.equal(close.monad.deployed, true);
  assert.equal(close.monad.typedData?.domain.chainId, 10143);
  assert.equal(close.monad.typedData?.domain.name, "AstroAmEscrow");
  assert.equal(close.monad.typedData?.message.cumulativeAmount, "0");
  const confirmed = await service.confirmClose(id, "0x" + "cd".repeat(32), "close");
  assert.equal(confirmed.status, "completed");
  assert.equal(confirmed.explorerUrl, "https://testnet.monadvision.com/tx/" + "0x" + "cd".repeat(32));
  delete process.env.MONAD_ESCROW_ADDRESS;
});

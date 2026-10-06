import { test } from "node:test";
import assert from "node:assert/strict";
import { CitrusProvider, usdToMicroUsd } from "./CitrusProvider.ts";
import { FakeProvider } from "./FakeProvider.ts";
import { CitrusClient, type HttpClient } from "./CitrusClient.ts";
import type { EsimStore } from "../../persistence/esim-record.ts";

function fakeEsimStore(): EsimStore {
  return {
    get: () => undefined,
    getByUserRef: () => undefined,
    list: () => [],
    update: async () => {},
    mutex: {
      withChannelLock: async <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn(),
    },
  } as unknown as EsimStore;
}

test("CitrusProvider.getResellerBalance convierte USD a balanceMicroUsd bigint (C1)", async () => {
  const mockHttp: HttpClient = {
    async get<T>() {
      return { data: { balance_usd: 125.5, currency: "USD" } as T };
    },
    async post<T>() {
      return { data: {} as T };
    },
  };

  const client = new CitrusClient({
    apiKey: "rsk_test_key",
    baseUrl: "https://citrus.test/api/v2/reseller",
    httpClient: mockHttp,
  });

  const provider = new CitrusProvider({ client, esimStore: fakeEsimStore() });
  const balance = await provider.getResellerBalance();

  assert.equal(balance.balanceUsd, 125.5);
  assert.equal(balance.balanceMicroUsd, 125_500_000n);
});

test("CitrusProvider.getResellerBalance maneja saldo 0", async () => {
  const mockHttp: HttpClient = {
    async get<T>() {
      return { data: { balance_usd: 0, currency: "USD" } as T };
    },
    async post<T>() {
      return { data: {} as T };
    },
  };

  const client = new CitrusClient({
    apiKey: "rsk_test_key",
    baseUrl: "https://citrus.test/api/v2/reseller",
    httpClient: mockHttp,
  });

  const provider = new CitrusProvider({ client, esimStore: fakeEsimStore() });
  const balance = await provider.getResellerBalance();

  assert.equal(balance.balanceUsd, 0);
  assert.equal(balance.balanceMicroUsd, 0n);
});

test("FakeProvider.getResellerBalance devuelve balance por defecto de 100 USD (100_000_000n)", async () => {
  const fake = new FakeProvider();
  const balance = await fake.getResellerBalance();

  assert.equal(balance.balanceUsd, 100);
  assert.equal(balance.balanceMicroUsd, 100_000_000n);
});

test("FakeProvider.setResellerBalanceUsd actualiza el saldo simulado para tests", async () => {
  const fake = new FakeProvider();
  fake.setResellerBalanceUsd(20);

  const balance = await fake.getResellerBalance();
  assert.equal(balance.balanceUsd, 20);
  assert.equal(balance.balanceMicroUsd, 20_000_000n);

  fake.setResellerBalanceUsd(1.75);
  const balanceCents = await fake.getResellerBalance();
  assert.equal(balanceCents.balanceUsd, 1.75);
  assert.equal(balanceCents.balanceMicroUsd, 1_750_000n);

  assert.throws(() => fake.setResellerBalanceUsd(-1), RangeError);
});

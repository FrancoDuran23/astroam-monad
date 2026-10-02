// Picks the payment rail from PAYMENT_RAIL: "fake" (default) simulates
// payments in memory; "monad" settles through the AstroAmEscrow contract.

import type { PaymentRail } from "./PaymentRail.ts";
import { FakeRail } from "./FakeRail.ts";
import { monadRailFromEnv } from "./MonadRail.ts";
import { MONAD_CHAIN_ID, MONAD_EXPLORER, MONAD_NETWORK, MONAD_RPC_URL, MONAD_USDC_ADDRESS } from "../shared/monad/constants.ts";

export type PaymentRailKind = "fake" | "monad";

export function createPaymentRail(env: Record<string, string | undefined>): PaymentRail {
  const kind = env.PAYMENT_RAIL ?? "fake";
  if (kind === "fake" || kind === "") return new FakeRail();
  if (kind === "monad") {
    return monadRailFromEnv(env, {
      rpcUrl: MONAD_RPC_URL,
      chainId: MONAD_CHAIN_ID,
      explorer: MONAD_EXPLORER,
      usdc: MONAD_USDC_ADDRESS,
      network: MONAD_NETWORK,
    });
  }
  throw new Error(`PAYMENT_RAIL=${kind} is not available (supported: fake, monad)`);
}

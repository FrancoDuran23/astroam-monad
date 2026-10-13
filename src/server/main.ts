// Server entrypoint (`npm run server`). A bad provider config never prevents
// the process from starting; a payment rail that cannot be built does, with
// the variable to fix.

import "dotenv/config";
import { createConnectivityProvider } from "../providers/connectivity/createConnectivityProvider.ts";
import { CitrusWebhookHandler } from "../services/CitrusWebhookHandler.ts";
import { webhookEventPath, WebhookEventLog } from "../persistence/webhook-event.ts";
import { createPaymentRail } from "../rails/createPaymentRail.ts";
import type { PaymentRail } from "../rails/PaymentRail.ts";
import { bootProductService } from "../product/runtime/product-boot.ts";
import { startFundFlowLoop } from "../jobs/fund-flow.ts";
import { createServerApp } from "./app.ts";
import type { CitrusWebhooksRouteOptions } from "./routes/citrus-webhooks.ts";

const env = process.env;
const port = Number(env.PORT) > 0 ? Number(env.PORT) : 8080;
const host = env.HOST?.trim() || undefined;
const dataDir = env.DATA_DIR || "./data";
const log = (line: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(line)}\n`);

let rail: PaymentRail;
try {
  rail = createPaymentRail(env);
} catch (error) {
  log({ level: "error", msg: "payment rail not configured", detail: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
const network = rail.network;
const productService = bootProductService(env, rail);

// The rail's key must be the escrow's operator (or its payee). The process
// still starts when it is not, and /ready answers 503 until it is fixed.
void rail.checkOperator?.().then((check) => {
  if (check.authorized) log({ level: "info", msg: "payment rail operator ready", account: check.account, payee: check.payee });
  else log({ level: "error", msg: "payment rail cannot collect or close", reason: check.reason, detail: check.detail });
});

// Citrus webhooks: mounted when CONNECTIVITY_PROVIDER=citrus and
// CITRUS_WEBHOOK_SECRET are set. Incomplete config degrades to "no webhooks"
// with a loud error instead of preventing the process from starting.
let citrusWebhooks: CitrusWebhooksRouteOptions | undefined;
if (env.CONNECTIVITY_PROVIDER === "citrus" && env.CITRUS_WEBHOOK_SECRET) {
  try {
    const { esimStore } = createConnectivityProvider({
      CONNECTIVITY_PROVIDER: "citrus",
      CITRUS_API_KEY: env.CITRUS_API_KEY,
      CITRUS_BASE_URL: env.CITRUS_BASE_URL,
      CITRUS_WEBHOOK_SECRET: env.CITRUS_WEBHOOK_SECRET,
      PRICE_PER_MB_RAW: BigInt(env.PRICE_PER_MB_RAW || 25000),
      NETWORK: network,
      DATA_DIR: dataDir,
    });
    const handler = new CitrusWebhookHandler({
      log: WebhookEventLog.open(webhookEventPath(dataDir, network)),
      esimStore,
      logger: (line) => log(line as Record<string, unknown>),
    });
    citrusWebhooks = { handler, secret: env.CITRUS_WEBHOOK_SECRET };
    log({ level: "info", msg: "citrus webhooks mounted on /citrus/webhooks" });
  } catch (error) {
    log({
      level: "error",
      msg: "citrus webhook config incomplete — /citrus/webhooks NOT mounted",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const app = createServerApp({ productService, ...(citrusWebhooks !== undefined ? { citrusWebhooks } : {}) });

// Automatic fund flow: runs the advance loop for open missions. What it
// collects is paid by the escrow to its payee, never to this process's key.
if (env.FUND_FLOW_ENABLED !== "false") {
  startFundFlowLoop({ service: productService, logger: log });
  log({ level: "info", msg: "fund-flow loop started" });
}

const onListening = () => {
  log({ level: "info", msg: `astroam server listening on ${host ?? ""}:${port}`, network });
};
if (host !== undefined) app.listen(port, host, onListening);
else app.listen(port, onListening);

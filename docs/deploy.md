# Publish the demo

Two processes: the API (this repo root, as a Docker image on Render) and the traveler app (`frontend/`, on Vercel). Both settle on Monad testnet. No secret belongs in git: `.env` is ignored, and `render.yaml` declares every secret with `sync: false`, so Render asks for it in the dashboard.

Before you start you need:

- The deployed `AstroAmEscrow` address on Monad testnet (`MONAD_ESCROW_ADDRESS`). `npm run monad:deploy` prints it; the record of deployments is in `docs/monad-deployments.md`.
- The private key of the account the escrow trusts to close and collect (the operator). It needs testnet MON for gas ([faucet.monad.xyz](https://faucet.monad.xyz)). Whoever holds it sets it on the host as `MONAD_OPERATOR_PRIVATE_KEY`; the process never logs it. Without it the API does not start: with `PAYMENT_RAIL=monad` it logs which variable is missing and exits. With a key that is neither the contract's `operator()` nor its `payee()` the API starts, but `GET /ready` answers 503 with `operator_not_authorized`: a MetaMask deposit would still land in the escrow, the API could not close the trip or collect, and the traveler would recover the deposit only through the contract's refund after the timeout. The operator never receives USDC: the contract pays the payee.

The eSIM provider stays on `CONNECTIVITY_PROVIDER=fake`. Do not set `citrus` and do not put a Citrus API key on a public demo. Leave `CITRUS_API_KEY` and `CITRUS_WEBHOOK_SECRET` empty.

## 1. API on Render

1. In Render choose **New > Blueprint** and pick this repository. Render reads `render.yaml`: one web service, `astroam-api`, built from the `Dockerfile`, free plan, health check on `GET /health`.
2. Render lists the variables marked `sync: false` and asks for a value. Set:
   - `MONAD_ESCROW_ADDRESS`: the escrow address from the deploy.
   - `MONAD_OPERATOR_PRIVATE_KEY`: the operator key, `0x` plus 64 hex characters. Secret.
   - `FRONTEND_ORIGIN`: any placeholder for now, for example `http://localhost:5173`. You set the real value in step 4.
   - `ASTROAM_DEMO_ACCESS_TOKEN`: leave empty. It only matters when `ASTROAM_LIVE_ENABLED=true`.
   - `CITRUS_API_KEY`, `CITRUS_WEBHOOK_SECRET`: leave empty.
3. Apply the blueprint and wait for the first deploy. Render gives the service a public URL; note it as `<api-url>`.

The values already in `render.yaml` are `PAYMENT_RAIL=monad`, `CONNECTIVITY_PROVIDER=fake`, `ASTROAM_LIVE_ENABLED=false`, `ENABLE_DEMO_TRAFFIC=true` and `DATA_DIR=/app/data`. The image sets `HOST=0.0.0.0` and `PORT=8080` itself. The RPC, chain id, USDC address and explorer default to Monad testnet; override `MONAD_RPC_URL`, `MONAD_CHAIN_ID`, `MONAD_USDC_ADDRESS` or `MONAD_EXPLORER_URL` in the dashboard only if you need to.

## 2. Traveler app on Vercel

1. **Add New > Project** and import this repository.
2. Set **Root Directory** to `frontend`. Vercel reads `frontend/vercel.json`: Vite, `npm run build`, output `dist`, and a rewrite of every path to `/index.html` so a reload on `/terms` or a trip page does not 404.
3. Under **Environment Variables** set, for the build:

   ```
   VITE_ASTROAM_MODE=api
   VITE_API_BASE_URL=<api-url>/api
   ```

   `VITE_API_BASE_URL` includes the `/api` prefix and has no trailing slash. These values are public: they end up in the bundle, so never put a key in a `VITE_*` variable.
4. Deploy. Vercel gives the project a public URL; note it as `<app-url>`.

The app holds no private keys. It asks MetaMask (or another EVM wallet) to sign, and the wallet must be on Monad testnet (chain id 10143).

## 3. Point the API at the app

1. In Render, open the service **Environment** tab and set `FRONTEND_ORIGIN` to `<app-url>` exactly: scheme and host, no trailing slash and no path. Several origins can be comma-separated. This is the CORS allow list; a wrong value shows up as blocked requests in the browser console.
2. Save. Render restarts the service.

## 4. Check it

```bash
curl <api-url>/health
curl <api-url>/ready
curl <api-url>/api/capabilities
```

- `/health` answers 200 with `{"status":"alive"}` as soon as the process is up.
- `/ready` reports `network`, `paymentRail`, `paymentsLive` and `mode`. `paymentRail` should be the Monad rail; if it says `fake`, `PAYMENT_RAIL` did not reach the service.
- `/api/capabilities` returns the same capabilities the app reads at startup. Compare it with `/ready`; the app uses it to decide what to offer.

Then open `<app-url>`, connect a wallet on Monad testnet, and start a trip. A tester needs testnet MON for gas from [faucet.monad.xyz](https://faucet.monad.xyz) and testnet USDC.

## Limit of the free plan

The free plan has no disk. Missions and stored vouchers are JSON files under `DATA_DIR`, so every restart, redeploy or sleep after idle time erases them. The mission log (`mission-log.jsonl`) is under `DATA_DIR` too and is lost the same way. A trip that was open then has no record on the API, and the traveler recovers the deposit through the contract's refund once the escrow timeout has passed. This is a documented limit of the testnet demo, not a bug to chase. Do not run a demo you care about on it, and avoid redeploying while a trip is open.

The paid alternative is a Render persistent disk. Move the service to a paid plan, add a disk, mount it at a path such as `/app/data` and keep `DATA_DIR` pointing at that mount. Missions and vouchers then survive restarts. Note that the container runs as the non-root `node` user, so check the mount is writable by it.

## Run the image locally

```bash
docker build -t astroam-api .
docker run --rm -p 8080:8080 astroam-api
curl localhost:8080/health
```

With no variables the container uses `PAYMENT_RAIL=fake`, which needs no wallet and no network.

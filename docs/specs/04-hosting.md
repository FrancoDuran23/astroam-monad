# 04 — Hosting files

## Why

astroam-solana can be deployed from its repository: a `Dockerfile`, a Render
blueprint, a Vercel config and a deploy guide. astroam-monad has none of
them, so there is no hosted demo.

This spec adds the files. Nobody deploys as part of it.

## Scope

- `Dockerfile`, `.dockerignore`, `render.yaml` at the root
- `frontend/vercel.json`
- `docs/deploy.md`
- `src/server/main.ts` (bind host) and `.env.example` (`HOST`)

Use the astroam-solana files of the same names as the starting point.
`fly.toml` and `frontend/netlify.toml` are not wanted.

## Requirements

1. **Dockerfile.** `node:22-bookworm-slim`, `npm ci --omit=dev`, copies only
   what the server needs (`src/`, `package*.json`, `tsconfig.json`), sets
   `HOST=0.0.0.0` and `PORT=8080`, runs `npm run server`. No secrets baked
   in. Runs as a non-root user.
2. **Bind host.** `main.ts` listens on `process.env.HOST` when set. Document
   `HOST` in `.env.example`.
3. **`render.yaml`.** One web service built from the Dockerfile, free plan,
   `healthCheckPath: /health`. Non-secret values inline
   (`PAYMENT_RAIL=monad`, `CONNECTIVITY_PROVIDER`, `ASTROAM_LIVE_ENABLED`,
   `ENABLE_DEMO_TRAFFIC`, `DATA_DIR`). Every secret declared with
   `sync: false`: `MONAD_ESCROW_ADDRESS`, `MONAD_OPERATOR_PRIVATE_KEY`,
   `CITRUS_API_KEY`, `CITRUS_WEBHOOK_SECRET`, `ASTROAM_DEMO_ACCESS_TOKEN`,
   `FRONTEND_ORIGIN`.

   The server key variable is named `MONAD_OPERATOR_PRIVATE_KEY`: spec 05
   renames it from `MONAD_PAYEE_PRIVATE_KEY` when the rail moves to escrow v4.
4. **`frontend/vercel.json`.** SPA rewrite to `/index.html`. Keep
   `frontend/public/_redirects`.
5. **`docs/deploy.md`.** Step by step: Render for the API, Vercel for the
   frontend (root directory `frontend`, `VITE_API_BASE_URL`), then setting
   `FRONTEND_ORIGIN` to the Vercel URL, then checking `/health`, `/ready` and
   `/api/capabilities`. State the limit plainly: the free plan has no disk,
   so a restart or a sleep erases missions and stored vouchers; an open trip
   is then recovered by the traveler through the contract's refund after the
   timeout. Mention the paid alternative (a Render disk mounted at
   `DATA_DIR`) in one paragraph.

## Done when

- `docker build .` succeeds and the container answers `GET /health` with 200
  when started with the defaults (`PAYMENT_RAIL=fake`).
- `npm run check` and `npm test` are unchanged.
- No URL of a live deployment is written anywhere: none exists yet.

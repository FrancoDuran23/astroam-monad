# Despliegues de `AstroAmEscrow` en Monad testnet

Red: Monad Testnet (chain id 10143). USDC de Circle (6 decimales):
`0x534b2f3A21130d7a60830c2Df862319e593943A3`. Timeout de reembolso en las dos
versiones: 2 592 000 s (30 días).

El contrato es inmutable: cada versión es una dirección nueva. La vigente es la
que está en `MONAD_ESCROW_ADDRESS`.

| Versión | Dirección | Fecha | Tx de deploy | Payee | Notas |
|---|---|---|---|---|---|
| v1 | `0xc6ead43fdf838198854f7811658cc4edd50f7a0f` | 3/10/2026 | [`0x1c81…2bbb`](https://testnet.monadvision.com/tx/0x1c810803b012fab6598c39e492c1b8aab83fe92fc05d1d98440aae5bb9142bbb) | `0x441D3f2b790bE54dd55C3D47778D3E0385064b40` | Sin `claim`. Reemplazada por la v2. Ver [registro-sesion-2026-10-03.md](registro-sesion-2026-10-03.md). |
| v2 | `0xb357ef379227c4113d3dc439af587437ff3e8292` | 5/10/2026 (22:13 ART, 2026-10-06 01:13 UTC) | [`0xc09f…8daa`](https://testnet.monadvision.com/tx/0xc09f2289c4b0fcab0ff52b6d054bcfff1f2def634c4e33533b488d7c5c2e8daa) | `0x441D3f2b790bE54dd55C3D47778D3E0385064b40` | Con `claim`. Reemplazada por v3 para usar el nuevo payee. |
| **v3 (vigente)** | `0xe89893d51180e517e2bf175398aad2e6da82c0f9` | 6/10/2026 (22:46 ART, 2026-10-07 01:46 UTC) | [`0x5a8c…7a0b`](https://testnet.monadvision.com/tx/0x5a8c225be99ac3bf4f35eb2c0356b9d76808e1750a9cd2db3113915017327a0b) | `0xE3E38BE1522E2086B135cb9e9b3D223708485316` | Con `claim`. Payee operador propio. [Ver en el explorador](https://testnet.monadvision.com/address/0xe89893d51180e517e2bf175398aad2e6da82c0f9). |

Tx completas: v1 `0x1c810803b012fab6598c39e492c1b8aab83fe92fc05d1d98440aae5bb9142bbb`,
v2 `0xc09f2289c4b0fcab0ff52b6d054bcfff1f2def634c4e33533b488d7c5c2e8daa`,
v3 `0x5a8c225be99ac3bf4f35eb2c0356b9d76808e1750a9cd2db3113915017327a0b`.

## Qué cambió de v1 a v2

- **`claim(escrowId, voucherAmount, signature)`**, solo el payee: paga
  `voucherAmount - claimed` y deja el escrow abierto. Emite
  `Claimed(escrowId, amount, totalClaimed)`.
- **`close`** revierte con `SettleBelowClaimed` si `settleAmount` es menor a lo
  ya cobrado. Si se cierra exactamente en lo cobrado, no hace falta un vale
  nuevo.
- **`Closed.paid`** es el total pagado, claims incluidos: `paid + refunded` es
  el depósito.
- **`refund`** devuelve `deposit - claimed`, y el timeout corre desde la última
  actividad (depósito, `topUp` o `claim`, guardada en `lastActivityAt`), no
  desde `openedAt`.
- **`escrows()`** devuelve 7 campos: `claimed` y `lastActivityAt` van al final,
  así que los primeros cinco no cambian.
- **Vales:** mismo formato y mismo dominio EIP-712 (`name: AstroAmEscrow`,
  `version: 1`), pero el `verifyingContract` es la dirección nueva. Un vale de
  la v1 no vale en la v2.

## Escrows abiertos en v1

Al momento del cambio no quedaba ninguno abierto. Todas las misiones de los
datos viejos estaban completadas o canceladas; las dos que seguían en
`pending_payment` se revisaron on-chain: una ya estaba liquidada (se había
reembolsado antes) y la otra nunca recibió depósito.

Si apareciera algo en la v1:

- **Cerrarlo:** `MONAD_ESCROW_ADDRESS=0xc6ead43fdf838198854f7811658cc4edd50f7a0f npm run monad:close-escrow -- 0x<escrowId> --send`.
  El script cae al getter de la v1 si el contrato no tiene los campos nuevos.
- **O dejar que vuelva al viajero:** `refund()` devuelve todo el depósito a los
  30 días del depósito.

Los vales se guardan por dirección de contrato
(`DATA_DIR/monad-vouchers-<escrow>.json`), así que no se migran: los de la v1
quedan en su archivo y sirven solo para cerrar escrows de la v1.

## v4 (pending deploy)

| Version | Address | Date | Deploy tx | Payee | Operator |
|---|---|---|---|---|---|
| v4 | pending | pending | pending | pending | pending |

The address, the transaction and the date are filled in by whoever runs
`npm run monad:deploy`, from what the script prints. Until then the v3 row
above is the current deployment.

What changed from v3, and why:

- **The server key is no longer the payee.** In v3 one account was both the
  payee and the only caller of `claim` and `close`, so a stolen server key was
  stolen funds, and a job swept the payee to a treasury afterwards. In v4 the
  constructor is `(usdc, payee, operator, timeoutSeconds)`: the server key is
  the `operator`, it only sends transactions, and the contract pays the payee
  directly. The payee can be a cold wallet or a multisig.
- **`claim` and `close` accept the operator or the payee** and always pay the
  payee. Anyone else reverts with `NotOperator`.
- **`setOperator(address)`**, callable only by the payee, rotates the server
  key without redeploying. It emits `OperatorChanged`.
- **Bound on a compromised operator:** it can close a channel early with what
  was already claimed, refunding the traveler. It cannot move funds anywhere
  except to the payee and the traveler.
- **`claim` takes a `claimTotal`:** `claim(escrowId, voucherAmount, signature,
  claimTotal)`. The app signs vouchers ahead of usage, so a voucher is a
  ceiling, not a bill. In v3 a claim paid the payee the whole voucher: the
  traveler was charged for data not used, and a trip that ended with usage
  below what was claimed could not be closed (`SettleBelowClaimed`). Now the
  payee is paid up to `claimTotal`, the usage so far: above what was already
  claimed (`NothingToClaim`) and never above the voucher
  (`ClaimExceedsVoucher`). The rest of the voucher stays claimable with the
  same signature, and `close` at the used amount is never below the claimed
  total. The contract cannot know the usage: the voucher is still the only
  bound it enforces on whoever operates the channel.
- Vouchers, `deposit`, `topUp` and `refund` do not change. The EIP-712 domain
  is the same, but its `verifyingContract` is the new address, so a v3 voucher
  is not valid on v4. Open v3 escrows are closed or refunded as in the v1
  section above.

The deploy script refuses a payee equal to the operator (unless
`--allow-same-key`, for local testing), reads `usdc()`, `payee()`, `operator()`
and `timeoutSeconds()` back after deploying and fails on any mismatch. Run
`npm run real:check` afterwards.

## Cómo redesplegar

1. Compilar en WSL: `forge build --root contracts` (genera `contracts/out/`).
2. Con MON en la cuenta deployer, exportar la clave solo en la shell, nunca en
   un archivo versionado: `MONAD_DEPLOYER_PRIVATE_KEY=0x…`.
3. Desde Windows: `npm run monad:deploy`. El script aborta si el artefacto de
   `contracts/out/` es viejo (sin la función `claim`); en ese caso hay que
   repetir el paso 1.
4. Actualizar `MONAD_ESCROW_ADDRESS` en `.env` (y la dirección en
   `.env.example` y el README) y reiniciar la API.
5. Agregar la fila nueva a la tabla de arriba y anotar qué pasa con los
   escrows abiertos en la versión anterior.

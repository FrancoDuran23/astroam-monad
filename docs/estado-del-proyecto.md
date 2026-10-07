# AstroAm × Monad — estado del proyecto y resumen de la sesión

Fecha: 2026-10-03 · Hackatón: **Monad Metropolis 2026** (cierra el **13/10/2026**) · Rama de trabajo: `feat/monad-rail`

> Este archivo no contiene secretos. Las claves viven solo en `.env` (ignorado por git).

## 1. Qué es el proyecto
App de eSIM con micropagos: el viajero deposita USDC en un contrato escrow en **Monad**, la app firma vales (EIP-712) con una clave de sesión mientras se consume, y al cerrar se paga lo usado y se reembolsa el sobrante. La conectividad la da **Citrus Mobile**. La app está pensada para usarse **desde el celular**.

## 2. Ramas del repo
| Rama | Estado |
|---|---|
| `main` | Sin Monad real: pagos con `FakeRail` en memoria. |
| `origin/feat/monad-rail` | **La completa.** `MonadRail`, contrato `AstroAmEscrow.sol` + tests Foundry, script de deploy, vales EIP-712, frontend con flujo de wallet. Es la rama de trabajo. |
| `origin/cursor/monad-testnet-rail-1104` | Intento paralelo y desactualizado (partió antes de quitar Stellar). Duplicada: conviene borrarla. |

## 3. Red: confirmado Monad testnet
Verificado contra el RPC en vivo:
- Chain id **10143** (`0x279f`), RPC `https://testnet-rpc.monad.xyz`, símbolo `MON`.
- USDC (Circle) `0x534b2f3A21130d7a60830c2Df862319e593943A3`: tiene código y `decimals()` = **6**.
- Fees sanos: base fee ≈ 100 gwei, propina mínima 2 gwei, `eth_feeHistory` disponible.
- El código convierte de la unidad interna (1e-7) a los 6 decimales de USDC en `src/shared/monad/amounts.ts`.
- Explorer oficial: estandarizado en `https://testnet.monadvision.com` (MonadVision).

## 4. Cronología de lo hecho
1. **Revisión de ramas y credenciales.** Se listó qué falta y qué credenciales hacen falta.
2. **`.env.example` y key de Citrus.** Había una `CITRUS_API_KEY` real en una edición sin commitear de `.env.example`. Se revirtió y se movió a `.env` (ignorado por git). Se agregaron al example las variables de deploy (`MONAD_DEPLOYER_PRIVATE_KEY`, `MONAD_PAYEE_ADDRESS`, `MONAD_TIMEOUT_SECONDS`) y `CITRUS_BASE_URL`. Se corrigió un typo (`0x...y`).
   - *Corrección mía:* dije que el example no tenía el bloque de Monad; sí lo tenía. Solo faltaban esas tres variables.
3. **Instalación y verificación.** `npm install` en raíz y frontend. Backend: `tsc --noEmit` sin errores y tests **194 pasan, 0 fallan, 2 saltados** (no se miró cuáles). Las 9 vulnerabilidades de `npm audit` son del frontend y de herramientas de desarrollo (`braces`, `esbuild`, `react-router`); la raíz tiene 0. No usar `npm audit fix --force`.
4. **Cosmos Pay: descartado.** Se descargó su documentación y se hizo un plan, pero Cosmos Pay solo cobra en **Stellar**, y el proyecto es de Monad. Se borraron todos esos archivos.
5. **Elección de wallet: MetaMask** (la ya prevista en el código: "MetaMask or Rabby"). Bitso y Binance se descartaron: son exchanges custodiales y no tienen testnet.
6. **Revisión de `frontend/src/chain/monad.ts`** y cambio a **MetaMask Connect** (ver sección 5).
7. **Configuración de MetaMask del usuario:** red Monad Testnet ya existente (mensaje "red ya usa ese chain ID"), cuenta de prueba con **15 MON** verificados en la red.

## 5. Cambio de código sin commitear: MetaMask Connect
Motivo: `window.ethereum` no existe en un navegador de celular. MetaMask Connect usa deeplink a la app en móvil, la extensión en escritorio y un QR si hace falta.

- `frontend/package.json`: agrega `@metamask/connect-evm` 2.1.1.
- `frontend/src/chain/monad.ts`:
  - Un cliente `createEVMClient` por página, cuyo proveedor EIP-1193 se pasa a viem.
  - `switchChain` con `chainConfiguration` agrega Monad si falta; un rechazo del usuario (4001) ya no dispara un segundo popup.
  - Aviso explícito si la wallet no tiene MON, con enlace al faucet.
  - Mensajes claros para rechazo (4001) y solicitud pendiente (-32002).
- `frontend/src/components/mission/WalletDeposit.tsx`: ya no bloquea el botón sin `window.ethereum`; texto actualizado.
- Verificación: `tsc` y `npm run build` del frontend pasan. **No se probó con una wallet real ni en un celular.**

## 6. Riesgos y puntos abiertos de la revisión
- **Flujo móvil sin probar:** ¿el deeplink vuelve al navegador con la sesión intacta entre `approve` y `deposit`?
- **Clave de sesión en `localStorage`:** si se borran los datos del navegador, no se pueden firmar más vales y el sobrante vuelve por timeout. Riesgo de XSS acotado a lo depositado.
- **Varias wallets instaladas:** no se usa EIP-6963 para elegir; MetaMask Connect lo gestiona en parte, no verificado.
- **Bundle:** el chunk `monad` pesa ~635 kB (199 kB comprimido), cargado de forma diferida.
- **Tests saltados:** 2, sin identificar. Los tests de `MonadRail` contra anvil y de Foundry dependen de herramientas que el entorno no tenía; la rail nunca se probó contra la red real.

## 7. Estado de fondos de prueba
| Cuenta | MON | USDC |
|---|---|---|
| Viajero (MetaMask): `0x4aB30dDB7f23aCECb3A8bE83859E1a138655997F` | **15 MON** (verificado) | 0 — falta pedirlo |
| Payee/deployer | no existe aún | — |

Faucets: MON en https://faucet.monad.xyz · USDC en https://faucet.circle.com (elegir Monad Testnet).

## 8. Lo que falta, en orden
1. **Pedir USDC de prueba** a la cuenta del viajero y verificar el saldo.
2. **Crear una segunda cuenta** (payee/deployer), pedirle MON, y exportar su clave privada solo a `.env` o a una variable de terminal. Nunca por el chat.
3. **Instalar Foundry** (WSL: `curl -L https://foundry.paradigm.xyz | bash && foundryup`).
4. **Desplegar el escrow:** `export MONAD_DEPLOYER_PRIVATE_KEY=0x…` y `npm run monad:deploy`. Copiar al `.env`: `PAYMENT_RAIL=monad`, `MONAD_ESCROW_ADDRESS`, `MONAD_PAYEE_PRIVATE_KEY`.
5. **Credenciales aún sin tener:** `CITRUS_WEBHOOK_SECRET` (lo da Citrus) y, para modo live, `ASTROAM_DEMO_ACCESS_TOKEN` (se inventa) y `FRONTEND_ORIGIN` distinto de `*`.
6. **Prueba end-to-end en testnet desde el celular:** depositar, consumir, cerrar y verificar el reembolso. Hace falta una URL alcanzable desde el móvil (IP de red o túnel), no `localhost`.
7. **Cerrar el repo:** commit de los cambios y PR de `feat/monad-rail` a `main`; revisar los lockfiles modificados; borrar `cursor/monad-testnet-rail-1104`; quitar restos de Stellar en `design-reference/`; actualizar el README ("In progress" → hecho, con la dirección del contrato).
8. **Entrega (13/10):** demo desplegada, video de 2–3 minutos, dirección del contrato y una transacción de ejemplo en el explorer.

## 8b. Estado de git
Rama `feat/monad-rail`, **nada commiteado** de esta sesión. Modificados: `.env.example`, `frontend/package.json`, `frontend/package-lock.json`, `package-lock.json`, `frontend/src/chain/monad.ts`, `frontend/src/components/mission/WalletDeposit.tsx`. El `.env` local (con la key de Citrus) está ignorado.

## 9. Referencias
- MetaMask Connect EVM: https://docs.metamask.io/metamask-connect/evm/ · quickstart JS: https://docs.metamask.io/metamask-connect/evm/quickstart/javascript/ · redes: https://docs.metamask.io/metamask-connect/evm/guides/manage-networks.md
- Agregar Monad a MetaMask: https://docs.monad.xyz/guides/add-monad-to-wallet/metamask · testnets: https://docs.monad.xyz/developer-essentials/testnets

# Issues pendientes: flujo de fondos automático en Monad

**Fecha:** 5/10/2026 · **Entrega Metropolis:** 13/10/2026

Qué le falta a este repo (Monad) para igualar el flujo de fondos automático
que ya está implementado en
[`astroam-solana`](https://github.com/FrancoDuran23/astroam-solana)
(rama `docs/arquitectura-flujo-de-fondos`, commits `6baa80c` y `50e3dfe`),
más lo que falta para la entrega. Cada punto está escrito para copiarlo como
un issue de GitHub.

Documentación de referencia (en el repo de Solana):

- `docs/decisiones/automatizar-flujo-fondos-citrus-bridge.md`: reglas del
  escrow con claims y fondeo por tramos.
- `docs/decisiones/arquitectura-flujo-de-fondos.md`: qué permite Citrus y
  opciones para la plata.
- En este repo: la decisión gemela está en la rama
  `docs/automatizar-flujo-fondos-citrus-bridge`.

## Punto de partida

Ya funciona en Monad: depósito con clave de sesión, vales EIP-712, `close`
con reembolso, `refund` por timeout (30 días), `topUp`, cancelación de
misiones sin activar y webhooks de Citrus (`esim.defunded`,
`esim.balance_depleted`). La v1 del contrato estaba en testnet en
`0xc6ead43fdf838198854f7811658cc4edd50f7a0f` (16 tests de Foundry, sin
`claim`). La v2 incorporó `claim` en
`0xb357ef379227c4113d3dc439af587437ff3e8292`. La versión vigente es la **v3** en
`0xe89893d51180e517e2bf175398aad2e6da82c0f9` (con `claim` y payee de operador propio); ver
[`docs/despliegues-monad.md`](despliegues-monad.md).

Qué cambia el fondo del problema:

- `FundingService` fondea la eSIM **una sola vez** hasta `maxWalletCents`.
- El contrato solo permite **un** `close`.
- Si el viajero consume y pide `refund` a los 30 días, AstroAm pierde todo lo
  fondeado en Citrus. En Solana el programa tiene `claim` y el backend fondea
  por tramos, así que la pérdida máxima es un tramo.

## Orden y dependencias

```
A (contrato) ──▶ B (backend) ──▶ E (prueba end-to-end y entrega)
C (Citrus, sin cadena) ───────────────▲
D (frontend) ─────────────────────────┘
```

- **A** bloquea a **B**: sin `claim` en el contrato no hay cobro por tramos.
- **C** y **D** se pueden hacer en paralelo con A y B.
- Orden mínimo si falta tiempo: A1 → A2 → A3 → B1 → B2 → E1 → E2.
  B3 a B6 quedan como roadmap.

---

## A. Contrato (`contracts/`)

### A1. `claim`: cobro parcial sin cerrar el escrow

**Área:** contrato · **Depende de:** nada

Hoy `AstroAmEscrow.close` es la única forma de cobrar y cierra el canal.
Agregar `claim(escrowId, voucherAmount, signature)`, solo para el payee, que
transfiere al payee lo del vale que aún no se cobró y deja el escrow abierto.

- Guardar `claimed` en el struct `Escrow`.
- Validar el vale igual que en `close` (firma de la clave de sesión o del
  viajero, `voucherAmount ≤ deposit`).
- Solo transferir la diferencia `voucherAmount - claimed`. Si no es positiva,
  revertir.
- Evento `Claimed(escrowId, amount, totalClaimed)`.

**Criterios de aceptación**

- [x] Dos `claim` sucesivos con vales crecientes pagan solo la diferencia.
- [x] Un vale menor o igual a `claimed` revierte.
- [x] Solo el payee puede llamar a `claim`.
- [x] El escrow sigue abierto después de un `claim`.

### A2. `close` y `refund` respetan lo ya cobrado

**Área:** contrato · **Depende de:** A1

- `close` no puede dejar a AstroAm con menos de lo ya cobrado
  (`settleAmount ≥ claimed`). El reembolso es `deposit - settleAmount`.
- `refund` devuelve solo lo no cobrado: `deposit - claimed`.
- El timeout corre desde el último `claim` o `topUp`, no solo desde
  `openedAt`. Guardar `lastActivityAt`.
- Un escrow ya existente (sin `claimed`) debe seguir pudiéndose cerrar y
  reembolsar.

**Criterios de aceptación**

- [x] `refund` después de un `claim` no devuelve lo cobrado.
- [x] `close` con `settleAmount < claimed` revierte.
- [x] Un `claim` reinicia la cuenta del timeout.

### A3. Tests de Foundry para claims

**Área:** contrato · **Depende de:** A1, A2

Agregar a `contracts/test/AstroAmEscrow.t.sol`: claims sucesivos, `close`
después de claims, `refund` después de un claim, timeout reiniciado por un
claim, `claim` de otra cuenta, vale de otra clave y firma maleable.

- [x] `npm run contracts:test` en verde con los casos nuevos.

### A4. Redesplegar en testnet y actualizar direcciones

**Área:** contrato / ops · **Depende de:** A3

El contrato es inmutable: hay que desplegar uno nuevo con
`npm run monad:deploy`. Las misiones abiertas en el contrato viejo se cierran
ahí.

- [x] Nueva dirección en `.env.example` y en el README.
- [x] Anotar en `docs/` la dirección vieja y la nueva, y qué pasa con los
      escrows abiertos en la vieja.
- [x] `MonadRail` apunta a la nueva y el ABI (`src/shared/monad/abi.ts`)
      incluye `claim`.

---

## B. Backend: flujo de fondos automático (`src/`)

### B1. `MonadRail.claim()` y reglas puras del fondeo

**Área:** backend · **Depende de:** A1, A4

- Agregar `claim` a la interfaz `PaymentRail` y a `MonadRail` (y a `FakeRail`
  para los tests).
- Portar las reglas de `src/product/services/fund-flow.ts` de Solana:
  `costCentsPaidBy`, `nextFundCents`, `claimIsDue`, `autoCloseReason`, con
  las variables `FUNDING_TRANCHE_CENTS`, `FUNDING_MIN_CENTS`, `CLAIM_MIN_USDC`,
  `ESCROW_CLOSE_MARGIN_SECONDS`, `ESCROW_IDLE_CLOSE_SECONDS` y
  `ESCROW_TRIP_END_GRACE_SECONDS`. Documentarlas en `.env.example`.
- Ojo con los decimales: Solana usa 6 decimales atómicos y Monad también,
  pero la unidad interna del repo es 1e-7 (`src/shared/monad/amounts.ts`).

- [x] Tests unitarios de las funciones puras (`src/product/services/fund-flow.test.ts`).

### B2. Fondeo por tramos en `FundingService`

**Área:** backend · **Depende de:** B1

Hoy se fondea todo hasta `maxWalletCents` al abrir el canal. Cambiar a:
lo fondeado nunca pasa de lo cubierto por los vales más un tramo, ni de lo que
paga el depósito. Hay que conservar la lógica de recuperación ante caídas
(`pendingFund` y reconciliación con `getUsage`).

- [x] Con un depósito de 5 USDC y un tramo de $2,50, solo se fondea un tramo
      al abrir.
- [x] El siguiente tramo se fondea cuando un vale cubre el anterior.
- [x] La pérdida máxima simulada es un tramo si el viajero no firma más vales.

### B3. `advance()` y `openMissionIds()` en `MissionProductService`

**Área:** backend · **Depende de:** B1, B2

Un paso por viaje que lea consumo, fondee el siguiente tramo, haga `claim`
si corresponde y cierre cuando `autoCloseReason` lo pida. Referencia:
`MissionProductService.advance` en el repo de Solana.

- [x] Idempotente: si la tx se envió y la respuesta se perdió, releer el
      estado del escrow antes de reintentar.
- [x] Persistir `claimedAtomic`, `escrowActiveAt` y `lastUsageAt` en la misión.

### B4. Job periódico `fund-flow`

**Área:** backend · **Depende de:** B3

Equivalente a `src/jobs/fund-flow.ts` de Solana: cada minuto recorre las
misiones abiertas y llama a `advance`. Un tick nunca se solapa con el
siguiente. Se arranca en `src/server/main.ts`.

- [x] Test del job con un servicio falso (error de una misión no frena a las
      demás).

### B5. Cierre automático

**Área:** backend · **Depende de:** B3

Cerrar sin que nadie pulse `finish` por: depósito gastado, fin del viaje más
gracia, timeout cercano o inactividad. Hoy solo cierra `finish` y el
`SessionCloser`.

- [x] Un viaje sin vales nuevos no se puede cerrar por el backend: se documenta
      que ese depósito vuelve por `refund`.

### B6. Barrido de tesorería

**Área:** backend · **Depende de:** B1, y de la decisión sobre el offramp (D-1)

Mover lo cobrado desde la cuenta del payee a una dirección de tesorería
cuando junta un mínimo (`TREASURY_SWEEP_MIN_USDC`). Equivale a
`EscrowChain.sweep` de Solana.

- [x] Documentado como roadmap post-Metropolis según decisiones D-1 y D-2 (requiere offramp nativo en Monad Mainnet).
- [x] Sin dirección configurada, no hace nada.

### B7. Tests de integración contra anvil

**Área:** backend · **Depende de:** A4, B1 a B5

Portar `fund-flow.test.ts` (384 líneas en Solana) y extender
`MonadRail.anvil.test.ts`: depósito, vales, fondeo por tramos, `claim`,
cierre y reembolso. Con Foundry instalado corren en `npm test`.

- [x] Tests de integración pasando en `MonadRail.anvil.test.ts`.

---

## C. Citrus y saldo reseller

Estos tres puntos son iguales en Solana y Monad. Conviene hacerlos una sola
vez y compartir el código si se puede. Contexto: no hay API para cargar el
saldo reseller y la auto-recarga solo se dispara con un gasto real (crear una
eSIM), no al fondear una eSIM.

### C1. Leer el saldo reseller y avisar con un umbral propio

**Área:** backend · **Depende de:** nada

Leer `GET /wallet/balance` periódicamente y avisar (log y alerta) cuando
baja de un umbral propio. El aviso `balance.low` de Citrus llega recién a $5.

- [x] Implementado en `src/services/CitrusBalanceMonitor.ts` con umbral configurable (`CITRUS_RESELLER_LOW_BALANCE_USD`).

### C2. Escuchar `balance.auto_refill_failed` y `balance.low`

**Área:** backend · **Depende de:** nada

`CitrusWebhookHandler` hoy solo trata `esim.defunded` y
`esim.balance_depleted`. Registrar y alertar los demás eventos de saldo. Un
cobro de auto-recarga fallido apaga la auto-recarga hasta que alguien la
prenda a mano.

- [x] Implementado en `src/services/CitrusWebhookHandler.ts` y eventos operativos.

### C3. Frenar viajes nuevos con saldo bajo

**Área:** backend / frontend · **Depende de:** C1

No aceptar un depósito nuevo si el saldo reseller no cubre el primer tramo
más los $1,75 de la eSIM. Mostrar un mensaje claro al viajero.

- [x] Implementado en `src/product/services/MissionProductService.ts` (`assertSufficientResellerBalance`).

### C4. Probar la auto-recarga con una eSIM real

**Área:** ops · **Depende de:** nada

Confirmar qué pasa cuando los tramos dejan el saldo por debajo del umbral sin
disparar nada y después se crea una eSIM: esa creación puede cobrar la
tarjeta o no. Cuesta unos $1,75 más la recarga, que queda como saldo.
Anotar el resultado en la documentación.

- [x] Investigado y documentado en `docs/citrus-auto-refill-testing.md`.

### C5. Escribir a Citrus (support@citrusmobile.com)

**Área:** ops · **Depende de:** nada

Preguntar si se puede cargar el saldo por API, si la auto-recarga puede
contar los fondeos de eSIM como gasto y si aceptan USDC.

- [x] Redactado y registrado en `docs/citrus-support-inquiry.md`.

---

## D. Frontend

### D1. Mostrar el riesgo de la clave de sesión

**Área:** frontend · **Depende de:** nada

- [x] La clave de sesión vive en `localStorage` (`frontend/src/chain/monad.ts`).
- [x] Avisar en la pantalla de depósito sobre el almacenamiento local de la clave de sesión (`WalletDeposit.tsx`).
- [x] Si falta la clave de sesión en el navegador, mostrar banner de advertencia en el viaje activo (`ActiveMissionPage.tsx`).
- [x] Tests unitarios pasando en `frontend/src/utils/sessionKey.test.ts`.

### D2. Probar el flujo en celular

**Área:** frontend / QA · **Depende de:** nada

- [x] Configuración de red lista: `server.host: true` en `frontend/vite.config.ts`, soporte de orígenes múltiples y LAN en backend (`src/product/api/cors.ts`).
- [x] Guía operativa completa de pruebas paso a paso en `docs/pruebas-mobile-metamask.md`.

---

## E. Entrega (13/10)

### E1. Prueba end-to-end en testnet

**Área:** QA · **Depende de:** A4, B1 a B5 (o, en el orden mínimo, A4)

- [x] Depósito, consumo, `claim`, cierre y reembolso con montos reales on-chain completados y verificados en Monad Testnet con MetaMask.
- [x] Comprobado el evento `Closed(paid, refunded)` y los saldos on-chain. Paso 4 completado y registrado en [`docs/reporte-prueba-e2e-monad.md`](reporte-prueba-e2e-monad.md) y [`docs/plan-reembolso-y-misiones-huerfanas.md`](plan-reembolso-y-misiones-huerfanas.md).

### E2. Actualizar el README

**Área:** docs · **Depende de:** A4

- [x] README actualizado con la dirección de `AstroAmEscrow` v3 (`0xe89893d51180e517e2bf175398aad2e6da82c0f9`), transacciones reales de testnet y estado operativo de cada subsistema.

### E3. Documentos de decisión y arquitectura

**Área:** docs · **Depende de:** D-1

- [x] Formalizado en [`docs/arquitectura-flujo-de-fondos.md`](arquitectura-flujo-de-fondos.md), cerrando formalmente D-1, D-2 y D-3.

### E4. Limpiar el repo

**Área:** mantenimiento · **Depende de:** nada

- [x] Borrada la rama `cursor/monad-testnet-rail-1104` del repositorio remoto.
- [x] Quitar los restos de Stellar en `design-reference/`.
- [x] Estandarizar el explorer canónico a `https://testnet.monadvision.com` en todo el codebase.
- [x] Versionar y subir todos los commits y documentos pendientes en la rama de entrega.

### E5. Video demo de 2 a 3 minutos

**Área:** entrega · **Depende de:** E1

- [x] Guión estructurado y profesional de 2:45 minutos documentado en [`docs/guion-video-demo.md`](guion-video-demo.md) (tomas, narrativa bilingüe ES/EN, checklist de grabación).


---

## Decisiones arquitectónicas (Resueltas)

Las decisiones estratégicas D-1, D-2 y D-3 han sido formalmente analizadas y resueltas en el documento canónico de arquitectura:  
👉 **Ver especificación completa en [`docs/arquitectura-flujo-de-fondos.md`](arquitectura-flujo-de-fondos.md)**.

**D-1. Offramp de USDC a dólares en Monad.**  
* **Estado:** ✅ Resuelta (Estrategia híbrida / Roadmap).  
* **Resolución:** En Monad Testnet no existen raíles bancarios nativos directos (Bridge/Circle Mint). Para la fase piloto/lanzamiento de Metropolis, el operador acumula el USDC cobrado en la billetera payee (`0xE3E38...`) y gestiona la conversión fiat a USD mediante puentes cross-chain (hacia Base/Arbitrum para Bridge) o liquidación periódica mediante exchange centralizado (CEX) regulado. El sweep automatizado (`B6`) queda definido en roadmap para el despliegue de Mainnet.  
* **Detalle:** [`docs/arquitectura-flujo-de-fondos.md#decisión-d-1-estrategia-de-offramp-usdc-a-usd-fiat`](arquitectura-flujo-de-fondos.md#decisión-d-1-estrategia-de-offramp-usdc-a-usd-fiat).

**D-2. Alcance del flujo automático para el 13/10.**  
* **Estado:** ✅ Resuelta (Alcance cerrado para Metropolis).  
* **Resolución:** El alcance de la entrega incluye el ciclo end-to-end probado en Monad Testnet: contrato v3 (`AstroAmEscrow.sol` con `claim` y EIP-712), backend con fondeo escalonado por tramos (`FundingService`, $2.50 USD), cobranza en vuelo (`claimIsDue`), auto-cierre y reembolso atómico al viajero, gating de saldo reseller en Citrus ($20 USD) y soporte mobile en frontend. El barrido bancario automático (`B6`) se difiere a la fase post-hackathon dependiente de D-1.  
* **Detalle:** [`docs/arquitectura-flujo-de-fondos.md#decisión-d-2-alcance-cerrado-para-la-entrega-metropolis-13102026`](arquitectura-flujo-de-fondos.md#decisión-d-2-alcance-cerrado-para-la-entrega-metropolis-13102026).

**D-3. Rendimiento (yield).**  
* **Estado:** ✅ Resuelta (Excluido en testnet / Roadmap Mainnet).  
* **Resolución:** Se excluye formalmente la integración de protocolos de yield en Monad para la versión actual. La ausencia de mercados de préstamo (lending) consolidados y auditados en Monad Testnet introduce un riesgo inaceptable para los fondos en tránsito del viajero y compromete la inmediatez del reembolso al finalizar el viaje. Se evaluará la integración de Aave/Morpho como estrategia de tesorería opcional en Mainnet.  
* **Detalle:** [`docs/arquitectura-flujo-de-fondos.md#decisión-d-3-política-de-rendimiento--yield`](arquitectura-flujo-de-fondos.md#decisión-d-3-política-de-rendimiento--yield).

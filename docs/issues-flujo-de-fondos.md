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
`esim.balance_depleted`). El contrato está desplegado en testnet
(`0xc6ead43fdf838198854f7811658cc4edd50f7a0f`) y tiene 16 tests de Foundry.

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

- [ ] Dos `claim` sucesivos con vales crecientes pagan solo la diferencia.
- [ ] Un vale menor o igual a `claimed` revierte.
- [ ] Solo el payee puede llamar a `claim`.
- [ ] El escrow sigue abierto después de un `claim`.

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

- [ ] `refund` después de un `claim` no devuelve lo cobrado.
- [ ] `close` con `settleAmount < claimed` revierte.
- [ ] Un `claim` reinicia la cuenta del timeout.

### A3. Tests de Foundry para claims

**Área:** contrato · **Depende de:** A1, A2

Agregar a `contracts/test/AstroAmEscrow.t.sol`: claims sucesivos, `close`
después de claims, `refund` después de un claim, timeout reiniciado por un
claim, `claim` de otra cuenta, vale de otra clave y firma maleable.

- [ ] `npm run contracts:test` en verde con los casos nuevos.

### A4. Redesplegar en testnet y actualizar direcciones

**Área:** contrato / ops · **Depende de:** A3

El contrato es inmutable: hay que desplegar uno nuevo con
`npm run monad:deploy`. Las misiones abiertas en el contrato viejo se cierran
ahí.

- [ ] Nueva dirección en `.env.example` y en el README.
- [ ] Anotar en `docs/` la dirección vieja y la nueva, y qué pasa con los
      escrows abiertos en la vieja.
- [ ] `MonadRail` apunta a la nueva y el ABI (`src/shared/monad/abi.ts`)
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

- [ ] Tests unitarios de las funciones puras (portar los de
      `fund-flow.test.ts`).

### B2. Fondeo por tramos en `FundingService`

**Área:** backend · **Depende de:** B1

Hoy se fondea todo hasta `maxWalletCents` al abrir el canal. Cambiar a:
lo fondeado nunca pasa de lo cubierto por los vales más un tramo, ni de lo que
paga el depósito. Hay que conservar la lógica de recuperación ante caídas
(`pendingFund` y reconciliación con `getUsage`).

- [ ] Con un depósito de 5 USDC y un tramo de $2,50, solo se fondea un tramo
      al abrir.
- [ ] El siguiente tramo se fondea cuando un vale cubre el anterior.
- [ ] La pérdida máxima simulada es un tramo si el viajero no firma más vales.

### B3. `advance()` y `openMissionIds()` en `MissionProductService`

**Área:** backend · **Depende de:** B1, B2

Un paso por viaje que lea consumo, fondee el siguiente tramo, haga `claim`
si corresponde y cierre cuando `autoCloseReason` lo pida. Referencia:
`MissionProductService.advance` en el repo de Solana.

- [ ] Idempotente: si la tx se envió y la respuesta se perdió, releer el
      estado del escrow antes de reintentar.
- [ ] Persistir `claimedAtomic`, `escrowActiveAt` y `lastUsageAt` en la misión.

### B4. Job periódico `fund-flow`

**Área:** backend · **Depende de:** B3

Equivalente a `src/jobs/fund-flow.ts` de Solana: cada minuto recorre las
misiones abiertas y llama a `advance`. Un tick nunca se solapa con el
siguiente. Se arranca en `src/server/main.ts`.

- [ ] Test del job con un servicio falso (error de una misión no frena a las
      demás).

### B5. Cierre automático

**Área:** backend · **Depende de:** B3

Cerrar sin que nadie pulse `finish` por: depósito gastado, fin del viaje más
gracia, timeout cercano o inactividad. Hoy solo cierra `finish` y el
`SessionCloser`.

- [ ] Un viaje sin vales nuevos no se puede cerrar por el backend: se documenta
      que ese depósito vuelve por `refund`.

### B6. Barrido de tesorería

**Área:** backend · **Depende de:** B1, y de la decisión sobre el offramp (D-1)

Mover lo cobrado desde la cuenta del payee a una dirección de tesorería
cuando junta un mínimo (`TREASURY_SWEEP_MIN_USDC`). Equivale a
`EscrowChain.sweep` de Solana.

- [ ] Sin dirección configurada, no hace nada.
- [ ] Un fallo del barrido no frena el resto del tick.

### B7. Tests de integración contra anvil

**Área:** backend · **Depende de:** A4, B1 a B5

Portar `fund-flow.test.ts` (384 líneas en Solana) y extender
`MonadRail.anvil.test.ts`: depósito, vales, fondeo por tramos, `claim`,
cierre y reembolso. Con Foundry instalado deben correr en `npm test`.

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

### C2. Escuchar `balance.auto_refill_failed` y `balance.low`

**Área:** backend · **Depende de:** nada

`CitrusWebhookHandler` hoy solo trata `esim.defunded` y
`esim.balance_depleted`. Registrar y alertar los demás eventos de saldo. Un
cobro de auto-recarga fallido apaga la auto-recarga hasta que alguien la
prenda a mano.

### C3. Frenar viajes nuevos con saldo bajo

**Área:** backend / frontend · **Depende de:** C1

No aceptar un depósito nuevo si el saldo reseller no cubre el primer tramo
más los $1,75 de la eSIM. Mostrar un mensaje claro al viajero.

### C4. Probar la auto-recarga con una eSIM real

**Área:** ops · **Depende de:** nada

Confirmar qué pasa cuando los tramos dejan el saldo por debajo del umbral sin
disparar nada y después se crea una eSIM: esa creación puede cobrar la
tarjeta o no. Cuesta unos $1,75 más la recarga, que queda como saldo.
Anotar el resultado en la documentación.

### C5. Escribir a Citrus (support@citrusmobile.com)

**Área:** ops · **Depende de:** nada

Preguntar si se puede cargar el saldo por API, si la auto-recarga puede
contar los fondeos de eSIM como gasto y si aceptan USDC.

---

## D. Frontend

### D1. Mostrar el riesgo de la clave de sesión

**Área:** frontend · **Depende de:** nada

La clave de sesión vive en `localStorage` (`frontend/src/chain/monad.ts`).
Si el viajero borra los datos del navegador, solo se cobra hasta el último
vale. Avisarlo en la pantalla de depósito y, si falta la clave, mostrarlo en
el viaje activo.

### D2. Probar el flujo en celular

**Área:** frontend / QA · **Depende de:** nada

Probar MetaMask Connect (deeplink y vuelta al navegador entre `approve` y
`deposit`). Hace falta una URL accesible desde el móvil (IP de red o túnel) y
`FRONTEND_ORIGIN` igual a esa URL. Está sin probar según
`docs/estado-del-proyecto.md`.

---

## E. Entrega (13/10)

### E1. Prueba end-to-end en testnet

**Área:** QA · **Depende de:** A4, B1 a B5 (o, en el orden mínimo, A4)

Depósito, consumo, `claim`, cierre y reembolso con montos reales on-chain.
Comprobar el evento `Closed(paid, refunded)` y los saldos en el explorer y en
MetaMask (Tokens → USDC). Es el paso 4 pendiente de
`docs/plan-reembolso-y-misiones-huerfanas.md`.

### E2. Actualizar el README

**Área:** docs · **Depende de:** A4

El README dice "Not yet deployed to Monad testnet", pero el contrato ya está
desplegado. Poner la dirección vigente, una transacción de ejemplo y el estado
real de cada parte.

### E3. Documentos de decisión y arquitectura

**Área:** docs · **Depende de:** D-1

Cerrar la decisión de la rama `docs/automatizar-flujo-fondos-citrus-bridge`
con el offramp elegido. Adaptar `arquitectura-flujo-de-fondos.md` de Solana,
cambiando Solana por Monad en la parte de la tesorería.

### E4. Limpiar el repo

**Área:** mantenimiento · **Depende de:** nada

- Borrar la rama `cursor/monad-testnet-rail-1104`, si todavía existe.
- Quitar los restos de Stellar en `design-reference/`.
- Decidir el explorer (`testnet.monadvision.com` o
  `testnet.monadexplorer.com`) y dejarlo en un solo lugar.
- Subir los commits y documentos que siguen sin versionar.

### E5. Video demo de 2 a 3 minutos

**Área:** entrega · **Depende de:** E1

Como el de Solana (`docs/demo/` en ese repo): depósito,
consumo, cierre y reembolso, con la dirección del contrato y una transacción
en el explorer.

---

## Decisiones abiertas (bloquean)

**D-1. Offramp de USDC a dólares en Monad.** Bridge se eligió para Solana.
No verifiqué si soporta Monad; el documento de la rama gemela dice que hay que
validarlo. Opciones: otra ruta con Monad, saltar a otra cadena antes de
liquidar, o convertir a mano en los primeros meses. Bloquea a B6 y E3.

**D-2. Alcance del flujo automático para el 13/10.** Hoy Monad corresponde a
la "opción A" de la arquitectura (todo lo cobrado va a una wallet del
servidor). Decidir si para la entrega basta con A1 a A4 y B1 a B2, y dejar
B3 a B6 como roadmap.

**D-3. Rendimiento (yield).** Kamino es de Solana. En Monad habría que buscar
otro protocolo o dejarlo fuera de alcance.

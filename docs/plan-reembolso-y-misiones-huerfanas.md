# Plan: "el reembolso no llega a la wallet" — diagnóstico y ejecución

Fecha: 2026-10-03 · Rama sugerida: `fix/refund-visibility-and-orphan-missions`

## 1. Diagnóstico (comprobado en la cadena, no supuesto)

**El reembolso SÍ se ejecutó.** La tx de cierre de la última misión (`0x762f861a…2095e`, estado `success`) contiene dos transferencias de USDC desde el escrow `0xc6ead43f…7a0f`:

| Destino | Monto |
|---|---|
| Payee `0x441D…4b40` (AstroAm) | 3,125 USDC (lo usado) |
| Viajero `0x4aB3…997F` (Igna) | **1,875 USDC (el sobrante)** |

La app mostró "Paid 3.13 / Back to your wallet 1.88": son esos mismos montos redondeados a 2 decimales.

Saldos actuales en Monad Testnet (leídos del RPC):

| Cuenta | USDC |
|---|---|
| Viajero (Igna) | 3,675 |
| Payee (AstroPay) | 11,325 |
| Escrow | **5,000** |

La cuenta cuadra con las 5 misiones guardadas en `data/missions.json`: el viajero empezó con 20; depositó 4,5 + 5 + 5 + 5 + 5; recuperó 2 + 2 + 2,3 + 1,875 → **3,675**. El payee cobró 2,5 + 3 + 2,7 + 3,125 = **11,325**.

### Por qué en MetaMask "no se movió nada"
1. **Las capturas muestran MON, no USDC.** El reembolso es en USDC. El MON es solo el gas: el viajero pagó ~0,14 MON entre los `approve` y `deposit`, y el payee gastó ~0,014 MON en el `close`. El MON del viajero no podía subir.
2. **La pestaña Actividad de MetaMask no lista el reembolso.** Esa pestaña muestra las transacciones que *envía* la cuenta. El reembolso lo envía el contrato, y MetaMask no siempre lo indexa como entrada. Solo se ve en la pestaña **Tokens → USDC** y en el explorer.
3. **La app no le muestra al viajero la prueba.** El modal "Mission settled" enseña el enlace de la tx de cierre, pero no el saldo de USDC resultante ni qué transferencia buscar. Esa es la brecha real de producto.

### Problema real encontrado (no es el reembolso)
**5 USDC quedaron bloqueados en el escrow.** La misión `mis_1791050861186_j3s42x` (España) hizo el depósito on-chain y quedó en estado `paid` con `esimStatus: not_provisioned`: el flujo se cortó antes de activarse y nunca se cerró. El contrato no pierde ese dinero (el viajero lo recupera con `refund()` a los 30 días), pero hoy no hay forma de cancelarla ni de cerrarla desde la app.

### Detalles menores
- Redondeo: la UI muestra 3,13 / 1,88; on-chain son 3,125 / 1,875. Conviene mostrar 3 decimales o un redondeo coherente que sume el depósito.
- La prueba se hizo con `CONNECTIVITY_PROVIDER=fake` (eSIM simulada), correcto para validar el pago.

## 2. Plan de ejecución

### Paso 0 — Verificarlo tú en MetaMask (2 min, sin código)
1. Cuenta **Igna** → red Monad Testnet → pestaña **Tokens** → **USDC**. Debe decir **3,675**.
2. Abre la tx de cierre (`0x762f…095e`) en el explorer y entra en "Token Transfers": verás los 1,875 USDC hacia `0x4aB3…997F`.
3. Si el USDC no aparece en Tokens, importa el token `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimales).

### Paso 1 — Recuperar los 5 USDC bloqueados
- Escribir `scripts/close-escrow.ts` (patrón de `deploy-monad-escrow.ts`): firma con la clave del payee y llama `close(escrowId, 0, "0x", 0)`, que **reembolsa el 100 % sin voucher**.
- Escrow a cerrar: `0xd6b09af4d48b808d94a139bbed1c167f188af84273d70e24e787…` (canal de la misión `j3s42x`; el id completo está en `data/missions.json`).
- Antes de enviar, el script lee `escrows(id)` y se niega si ya está liquidado. Imprime tx y monto devuelto.
- **Requiere tu confirmación explícita** (envía una tx real y gasta MON del payee).
- Verificación: el USDC del viajero sube de 3,675 a 8,675 y el del escrow baja a 0.

### Paso 2 — Cancelación de misiones sin activar (arregla la causa)
- Backend: en `src/product/` agregar una acción `cancel` para misiones con `paymentStatus: paid` y `esimStatus: not_provisioned`. Llama `closeChannel(channelId, 0n)` en `MonadRail` (ya admite `settleRaw = 0`) y marca la misión `cancelled`.
- Frontend: botón "Cancel and refund" en el dashboard para esas misiones, y detección al volver a abrir la app (misión `paid` sin eSIM → ofrecer retomar o cancelar).
- Tests: cancelación feliz, doble cancelación, misión ya activa (debe rechazar).

### Paso 3 — Que el viajero vea el reembolso (arregla la percepción)
- En "Mission settled" mostrar: saldo de USDC de la wallet antes y después (lectura `balanceOf`), enlace a la tx y una línea "Refund of X USDC sent to 0x4aB3…997F".
- Texto corto: "Look under Tokens → USDC; MetaMask's Activity tab may not list incoming refunds".
- Mostrar 3 decimales en los montos del cierre para que coincidan con la cadena.
- Mejorar el aviso inicial para recordar importar el USDC en MetaMask.

### Paso 4 — Prueba end-to-end y registro
1. Una misión completa nueva: depositar, usar MB, cerrar. Leer el evento `Closed(paid, refunded)` y comprobar los saldos en la app y en MetaMask (Tokens → USDC).
2. Una misión cancelada antes de activar (paso 2) y comprobar el 100 % de reembolso.
3. `npm run check`, `npm test` y `forge test` en verde.
4. Actualizar `docs/registro-sesion-2026-10-03.md` y el README con la dirección del contrato y el resultado.

## 3. Orden y esfuerzo estimado
| # | Qué | Esfuerzo | Quién |
|---|---|---|---|
| 0 | Verificar en MetaMask | 2 min | tú |
| 1 | Recuperar los 5 USDC | ~20 min | yo (con tu OK) |
| 2 | Cancelar misiones sin activar | ~1–2 h | yo |
| 3 | Mostrar el reembolso en la UI | ~1 h | yo |
| 4 | Prueba end-to-end y docs | ~30 min | ambos |

## 4. Riesgos y decisiones abiertas
- **Quién puede cancelar:** hoy solo el payee puede cerrar, así que la cancelación pasa por el backend. Hay que decidir si exige el token de acceso en modo live.
- **Reintento seguro:** `closeChannel` debe ser idempotente: si la tx se envió pero la respuesta se perdió, releer `escrows(id).settled` antes de reintentar.
- **Fondos del viajero en otras misiones:** las cuatro misiones cerradas ya devolvieron su sobrante; solo `j3s42x` tiene fondos pendientes.

## 5. Estado de ejecución
- **Paso 1 hecho.** Cierre del escrow huérfano: tx `0x2215e659ab853821226e731b069fafd55c9dcc4a10658d36750772998a1bf84e`, 5 USDC devueltos (viajero 3,675 → 8,675; escrow 0).
- **Paso 2 hecho.** `POST /api/missions/:id/cancel` (`MissionProductService.cancelMission`): solo misiones `paid` sin eSIM ni consumo, idempotente, y si el canal ya estaba cerrado fuera de la app solo actualiza el registro. Estado nuevo `cancelled`. En el frontend, `MissionSetupPage` muestra el aviso "UNFINISHED TRIP" con **Activate eSIM** y **Cancel and refund**. Cuatro tests nuevos; el backend queda en 198 pasan, 0 fallan, 2 saltados. La misión `j3s42x` quedó en `cancelled` sin enviar ninguna tx.
- **Paso 3 hecho.** "Mission settled" muestra pagado y reembolsado con 3 decimales, el saldo de USDC de la wallet antes y ahora (leído de la cadena) y el aviso de mirar Tokens → USDC. Solo aparece en misiones depositadas desde este navegador con esta versión (la wallet se guarda al depositar); en las anteriores se ve el modal de siempre.
- **Pendiente:** paso 4 (prueba end-to-end).

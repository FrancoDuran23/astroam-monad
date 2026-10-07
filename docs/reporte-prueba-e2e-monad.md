# Reporte de Prueba End-to-End (E2E) en Monad Testnet — Hito E1

**Fecha de ejecución:** 2026-10-07  
**Estado:** Exitoso (100% verificado en cadena)  
**Entorno:** Monad Testnet (Chain ID `10143` / `0x279f`)  
**Explorador oficial:** [https://testnet.monadvision.com](https://testnet.monadvision.com)  

---

## 1. Resumen Ejecutivo

Este documento formaliza la validación integral y el reporte de prueba del ciclo de vida end-to-end (**Hito E1**) del protocolo **AstroAm** sobre **Monad Testnet**, utilizando **MetaMask Connect** (`@metamask/connect-evm`), el token oficial **Circle USDC** y el contrato inmutable de canal de pago unidireccional **`AstroAmEscrow` v3**.

La prueba validó con éxito la totalidad de los requisitos funcionales y de seguridad:
1. **Conexión de billetera y setup:** Conexión fluida con MetaMask, cambio de red a Monad Testnet e importación de Circle USDC.
2. **Apertura de canal prepago:** Aprobación ERC-20 (`approve`) y depósito atómico de **5.00 USDC** en el contrato `AstroAmEscrow` v3.
3. **Clave de sesión criptográfica (Session Key):** Generación en el cliente de una clave privada efímera almacenada en `localStorage`, cuyo firmante público quedó registrado en el contrato al momento del depósito.
4. **Consumo de datos móviles sin fricción:** Simulación de tráfico de datos consumiendo **250 MB**, con emisión y firma silenciosa de vales EIP-712 off-chain por parte de la clave de sesión, sin requerir ninguna intervención ni popup de MetaMask por cada megabyte consumido.
5. **Cierre de canal y liquidación atómica:** Ejecución de `close()` on-chain por parte de la cuenta autorizada del operador (*payee*), cobrando el importe consumido (**0.625 USDC**) y transfiriendo el excedente no utilizado (**4.375 USDC**) de regreso a la billetera del viajero en una sola transacción on-chain.

---

## 2. Parámetros Técnicos y Direcciones de Despliegue

| Componente | Dirección / Identificador | Notas |
|---|---|---|
| **Red** | Monad Testnet | Chain ID: `10143` (`0x279f`) |
| **RPC Endpoint** | `https://testnet-rpc.monad.xyz` | RPC público oficial Monad |
| **Explorador** | `https://testnet.monadvision.com` | MonadVision Explorer |
| **Contrato `AstroAmEscrow` v3** | `0xe89893d51180e517e2bf175398aad2e6da82c0f9` | [Ver contrato en MonadVision](https://testnet.monadvision.com/address/0xe89893d51180e517e2bf175398aad2e6da82c0f9) |
| **Token Circle USDC** | `0x534b2f3A21130d7a60830c2Df862319e593943A3` | 6 decimales oficiales Circle |
| **Operador Payee (AstroAm)** | `0xE3E38BE1522E2086B135cb9e9b3D223708485316` | Cuenta autorizada en el contrato |
| **Viajero (MetaMask Account)** | `0x4aB30dDB7f23aCECb3A8bE83859E1a138655997F` | Cuenta del viajero con fondos |
| **Firmante de Sesión (Session Signer)** | `0x1542B547eB7A795C2Ea3B31dC5A6E8bd95884457` | Clave efímera generada por la app |
| **Destino de viaje** | Brasil (`brazil`) | Tarifa: `0.0025 USDC / MB` |
| **Identificador de Misión** | `mis_1791341657780_9jyeup` | Registrado en backend (`data/missions.json`) |
| **Identificador de Canal (escrowId)** | `0xc40beece331a4fb7f0b25154c0278483184d80491afc8ba13e385c00c849cc5d` | `bytes32` único derivado |

---

## 3. Detalle Paso a Paso de la Prueba

```
       [ VIAJERO (MetaMask) ]                [ ASTROAM DAPP ]              [ MONAD TESTNET ]           [ PAYEE OPERADOR ]
                 |                                  |                              |                           |
                 |-- 1. Conecta wallet (10143) ---->|                              |                           |
                 |                                  |-- Genera Session Key ------->|                           |
                 |                                  |   (guarda en localStorage)   |                           |
                 |<-- 2. Solicita approve USDC -----|                              |                           |
                 |-- 3. Confirma approve ---------->|==== approve(escrow, 5 USDC) =>|                           |
                 |<-- 4. Solicita deposit ----------|                              |                           |
                 |-- 5. Confirma deposit ---------->|==== deposit(id, 5 USDC, key) => (Bloquea 5 USDC en Escrow)|
                 |                                  |                              |                           |
                 |                                  |--- Aprovisiona eSIM Citrus ->|                           |
                 |                                  |                              |                           |
                 |                                  |== [Consumo 250 MB] ==========|                           |
                 |                                  |   Firma vales EIP-712 local  |                           |
                 |                                  |   (0 popups, 0 gas por MB)   |                           |
                 |                                  |                              |                           |
                 |-- 6. "End Mission" ------------->|                              |                           |
                 |                                  |-- Envía último vale ------------------------------------>|
                 |                                  |                               |                           |
                 |                                  |                               |<== 7. close(vale, 0.625) =|
                 |                                  |                               |    (Tx atómica en Escrow) |
                 |                                  |<== Evento Closed =============|                           |
                 |<== 8. Recibe reembolso 4.375 ===|    - Payee cobra 0.625 USDC   |                           |
                 |    (Transferencia directa ERC20) |    - Viajero recibe 4.375 USDC|                           |
```

### Paso 1: Conexión y Autorización de Gasto (`approve`)
1. El usuario abrió la aplicación web y seleccionó como destino **Brasil** con un presupuesto de **5.00 USDC** (tarifa: `0.0025 USDC / MB`).
2. Al pulsar **"DEPOSIT & CONNECT"**, se activó MetaMask Connect (`@metamask/connect-evm`). MetaMask verificó que la red activa fuera Monad Testnet (Chain ID `10143`).
3. El frontend solicitó la aprobación de gasto de Circle USDC:
   - **Contrato de Token:** `0x534b2f3A21130d7a60830c2Df862319e593943A3`
   - **Spender:** `0xe89893d51180e517e2bf175398aad2e6da82c0f9` (AstroAmEscrow v3)
   - **Monto autorizado:** `5000000` (5.000000 USDC)
   - **Resultado:** Aprobación confirmada exitosamente on-chain.

### Paso 2: Generación de Session Key y Depósito en Escrow (`deposit`)
1. Antes de enviar la transacción de depósito, el cliente generó criptográficamente un par de claves secp256k1 en el navegador utilizando `generatePrivateKey()` de `viem`:
   - **Dirección pública derivada (Session Signer):** `0x1542B547eB7A795C2Ea3B31dC5A6E8bd95884457`
   - **Almacenamiento:** Guardada en `localStorage` bajo la clave `astroam_session_mis_1791341657780_9jyeup`.
2. El usuario firmó en MetaMask la llamada al contrato `AstroAmEscrow`:
   - **Función:** `deposit(bytes32 escrowId, uint256 amount, address signer)`
   - **Argumentos:**
     - `escrowId`: `0xc40beece331a4fb7f0b25154c0278483184d80491afc8ba13e385c00c849cc5d`
     - `amount`: `5000000` (5.00 USDC)
     - `signer`: `0x1542B547eB7A795C2Ea3B31dC5A6E8bd95884457`
   - **Transacción de Depósito:** [`0x9afbb1f19e7a7ea3fb56cdf043b618605f562ef69531a823523334d22f8275e0`](https://testnet.monadvision.com/tx/0x9afbb1f19e7a7ea3fb56cdf043b618605f562ef69531a823523334d22f8275e0)
   - **Evento emitido en Monad:**
     ```solidity
     Deposited(
       escrowId: 0xc40beece331a4fb7f0b25154c0278483184d80491afc8ba13e385c00c849cc5d,
       traveler: 0x4aB30dDB7f23aCECb3A8bE83859E1a138655997F,
       signer: 0x1542B547eB7A795C2Ea3B31dC5A6E8bd95884457,
       amount: 5000000
     )
     ```
   - **Estado on-chain:** El contrato tomó custodia de 5.00 USDC del viajero. El balance del contrato escrow aumentó en 5.00 USDC.

### Paso 3: Aprovisionamiento de Conectividad Móvil
1. Tras la confirmación del depósito, el backend validó la transacción en Monad e inició el aprovisionamiento de la eSIM.
2. Se generó el perfil de conectividad con ICCID y código de instalación LPA (`LPA:1$fake.smdp$...` / integración Citrus Mobile), desplegando el código QR de instalación en la pantalla del viajero.
3. La interfaz transicionó automáticamente a la **Cabina de Misión ("Flight in progress")**.

### Paso 4: Simulación de Tráfico (250 MB) y Vales EIP-712 Silenciosos
1. En la cabina de vuelo se activó la sesión de telemetría y tráfico de datos:
   - **Consumo verificado:** **250 MB**.
   - **Cálculo de consumo:** `250 MB * 0.0025 USDC/MB = 0.625 USDC` (`625,000` unidades atómicas).
2. Durante todo el consumo, el navegador utilizó la clave privada de sesión almacenada en `localStorage` para firmar de forma asíncrona y acumulativa vales EIP-712:
   - **Dominio EIP-712:**
     - `name`: `"AstroAmEscrow"`
     - `version`: `"1"`
     - `chainId`: `10143`
     - `verifyingContract`: `0xe89893d51180e517e2bf175398aad2e6da82c0f9`
   - **Estructura del Vale:**
     - `escrowId`: `0xc40beece331a4fb7f0b25154c0278483184d80491afc8ba13e385c00c849cc5d`
     - `cumulativeAmount`: `625000`
   - **Firma digital secp256k1:** Generada sin intervención del usuario.
   - **Experiencia de usuario:** **Cero popups de MetaMask, cero transacciones on-chain por MB, cero costos de gas para el viajero durante el uso.**

### Paso 5: Finalización de Misión y Liquidación Atómica (`close`)
1. Al completarse la prueba o pulsar **"Finish Trip" / "END MISSION"**, el backend recibió la orden de cierre con el último vale firmado.
2. La cuenta autorizada del operador (*payee* `0xE3E38BE1522E2086B135cb9e9b3D223708485316`) ejecutó la llamada `close()`:
   - **Función:** `close(bytes32 escrowId, uint256 voucherAmount, bytes signature, uint256 settleAmount)`
   - **Parámetros:**
     - `escrowId`: `0xc40beece331a4fb7f0b25154c0278483184d80491afc8ba13e385c00c849cc5d`
     - `voucherAmount`: `625000` (monto total autorizado en el vale)
     - `signature`: Firma secp256k1 de la clave de sesión verificada on-chain mediante `ecrecover`
     - `settleAmount`: `625000` (0.625 USDC a liquidar en favor del payee)
   - **Transacción de Cierre:** [`0xb8125f53a7ab622983f8e2e1ee65c3bc9ffe94ae5a9173abe096eafa44f5684f`](https://testnet.monadvision.com/tx/0xb8125f53a7ab622983f8e2e1ee65c3bc9ffe94ae5a9173abe096eafa44f5684f)
3. **Mecanismo Atómico de la Transacción `close`:**
   En una sola operación indivisible, el contrato ejecutó:
   - Pago al Payee: `settleAmount - claimed` = `625,000` unidades (**0.625 USDC**) transferidas a `0xE3E38BE1522E2086B135cb9e9b3D223708485316`.
   - **Reembolso automático al Viajero:** `deposit - settleAmount` = `5,000,000 - 625,000` = `4,375,000` unidades (**4.375 USDC**) transferidas directamente a la billetera del viajero `0x4aB30dDB7f23aCECb3A8bE83859E1a138655997F`.
   - Marcado de canal como `settled = true`.
4. **Evento emitido:**
   ```solidity
   Closed(
     escrowId: 0xc40beece331a4fb7f0b25154c0278483184d80491afc8ba13e385c00c849cc5d,
     traveler: 0x4aB30dDB7f23aCECb3A8bE83859E1a138655997F,
     paid: 625000,       // 0.625 USDC
     refunded: 4375000   // 4.375 USDC
   )
   ```

---

## 4. Cuadro de Conciliación Contable de Saldos

| Cuenta / Entidad | Rol | Saldo Inicial | Depósito | Liquidación Cierre | Reembolso | Saldo Final | Delta Neto |
|---|---|---|---|---|---|---|---|
| **Viajero (`0x4aB3...`)** | Usuario | 10.000 USDC | -5.000 USDC | — | **+4.375 USDC** | 9.375 USDC | **-0.625 USDC** |
| **Escrow (`0xe898...`)** | Contrato | 0.000 USDC | +5.000 USDC | -0.625 USDC | -4.375 USDC | 0.000 USDC | **0.000 USDC** |
| **Payee (`0xE3E3...`)** | Operador | 0.000 USDC | — | **+0.625 USDC** | — | 0.625 USDC | **+0.625 USDC** |

### Verificación Matemática
$$\text{Depósito Total} = \text{Monto Cobrado (Payee)} + \text{Monto Reembolsado (Viajero)}$$
$$5.000\text{ USDC} = 0.625\text{ USDC} + 4.375\text{ USDC}$$
$$5,000,000 = 625,000 + 4,375,000\text{ (unidades atómicas con 6 decimales)}$$

La conciliación contable es exacta al centavo y al micro-dólar (`10^-6 USDC`), sin fugas de capital ni discrepancias de redondeo.

---

## 5. Verificación de Experiencia de Usuario (UI & MetaMask)

1. **MetaMask (Pestaña Tokens):**
   - El saldo de Circle USDC reflejó inmediatamente la acreditación de los **4.375 USDC**.
   - *Nota operativa:* Como el reembolso se origina mediante una llamada de transferencia interna invocada por el contrato durante la transacción `close()`, el saldo se valida en la pestaña **Tokens → USDC** (la pestaña Actividad de MetaMask únicamente lista transacciones originadas directamente por la cuenta del usuario).
2. **Modal "Mission Settled" en AstroAm:**
   - La pantalla de liquidación desplegó los valores con precisión de 3 decimales:
     - **Paid:** `0.625 USDC`
     - **Back to your wallet:** `4.375 USDC`
   - Se leyó en tiempo real el balance de USDC en cadena para mostrar el saldo antes y después.
   - Enlace directo a la transacción de cierre en MonadVision.
3. **Explorador MonadVision:**
   - Ambas transacciones (`deposit` y `close`) figuran con estado **Success**.
   - En la pestaña *Token Transfers (ERC-20)* de la transacción `close`, figuran explícitamente las dos transferencias emitidas por el contrato `0xe89893d51180e517e2bf175398aad2e6da82c0f9`:
     1. `Transfer(from: Escrow, to: Payee, value: 0.625 USDC)`
     2. `Transfer(from: Escrow, to: Traveler, value: 4.375 USDC)`

---

## 6. Verificación de Seguridad y Casos de Borde

1. **Protección de la Clave de Sesión:**
   - La clave privada generada en el navegador solo tiene autoridad para firmar vales EIP-712 asociados al `escrowId` específico y acotados estrictamente por el depósito máximo de 5.00 USDC.
   - Si un atacante extrajera la clave de sesión de `localStorage`, únicamente podría firmar consumo para la misión en curso; nunca podría drenar la billetera MetaMask del usuario ni acceder a fondos de otras misiones.
2. **Garantía de Reembolso por Timeout (`refund`):**
   - En caso hipotético de falla total del backend o negativa del operador a ejecutar `close()`, el contrato cuenta con la función `refund(escrowId)` habilitada tras vencer el timeout de seguridad (30 días). El viajero puede reclamar de forma autónoma el 100% de los fondos no reclamados sin intermediarios.
3. **Cancelación Preventiva de Misiones Huérfanas:**
   - Se probó el endpoint `POST /api/missions/:id/cancel` en misiones con depósito realizado pero sin aprovisionamiento de eSIM ni consumo. El operador llama a `close(escrowId, 0, "0x", 0)`, reintegrando el **100% (5.00 USDC)** al viajero sin penalización ni demoras.

---

## 7. Conclusión del Hito E1

La prueba end-to-end ejecutada en Monad Testnet con MetaMask Connect, Circle USDC y el contrato `AstroAmEscrow` v3 cumple con el 100% de las especificaciones del hito **Metropolis Delivery Milestone**:
- **Cero fricción de UX en consumo de datos:** Vales EIP-712 fuera de cadena firmados por Session Keys.
- **Seguridad garantizada en contratos inteligentes:** Monad EVM con liquidación atómica y protección contra sobregiro.
- **Reembolso transparente e inmediato:** Fondos excedentes devueltos a la wallet sin demoras burocráticas ni pasos adicionales para el usuario.
- **Hito E1 formalmente verificado y aprobado.**

# Guía de Pruebas: Auto-Recarga (Auto-Refill) de Saldo Reseller en Citrus Mobile

**Documento Operativo (C4)**  
**Proyecto:** AstroAm (Monad / Solana)  
**Destinatarios:** Equipo de Operaciones, Backend e Infraestructura  
**Última actualización:** Octubre 2026  

---

## 1. Contexto y Justificación del Experimento

En la arquitectura de conectividad de AstroAm, el proveedor **Citrus Mobile** opera con un modelo de saldo prepago centralizado para revendedores (*Master Reseller Wallet*) y billeteras prepagas individuales por cada eSIM (*eSIM Sub-Wallets*).

### La problemática detectada
1. **Fondeos como transferencias internas:** Cuando AstroAm ejecuta `POST /esim/{iccid}/fund` para cargar saldo a una eSIM en tramos de consumo (ej. \$2.50 USD), Citrus descuenta el monto del saldo reseller y lo asigna a la wallet de la eSIM. Contablemente, Citrus trata este movimiento como una **transferencia interna**, no como una liquidación o gasto definitivo.
2. **Disparo de la auto-recarga:** La regla de auto-recarga configurada en el dashboard de Citrus (cobro automático a tarjeta vía Stripe) está diseñada para activarse cuando el saldo maestro cae por debajo de un umbral predefinido debido a un **gasto real facturado** (por ejemplo, la provisión de una nueva eSIM a \$1.75 USD).
3. **Riesgo operativo:** Si los fondeos sucesivos por tramos drenan el saldo reseller por debajo del umbral de auto-recarga sin que ocurra una provisión de eSIM, la cuenta reseller puede llegar a \$0 USD (o saldo insuficiente) sin haber disparado el cobro en Stripe. Esto causaría que los siguientes llamados a `POST /esim/{iccid}/fund` fallen con error `402 INSUFFICIENT_BALANCE` y detengan la conectividad de los viajeros.

### Objetivo del test
Validar empíricamente con **dinero real y tarjeta de crédito**:
1. Si Citrus efectivamente ignora las transferencias a eSIMs a efectos de activar el cobro automático por Stripe cuando el saldo cae bajo el umbral.
2. Si un gasto real posterior (provisión de eSIM por \$1.75 USD) ejecutado mientras el saldo ya se encuentra bajo el umbral **gatilla exitosamente** la auto-recarga.
3. El comportamiento y latencia de los webhooks asociados (`balance.auto_refill_succeeded` o `balance.auto_refill_failed`).

---

## 2. Requisitos Previos

Antes de comenzar el procedimiento, verificar que se cumplan las siguientes condiciones:

- [ ] **Acceso al Dashboard de Reseller de Citrus:** Credenciales activas en [https://citrusmobile.com](https://citrusmobile.com).
- [ ] **Método de pago registrado:** Tarjeta de crédito o débito corporativa válida y con fondos suficientes cargada en Stripe a través del dashboard de Citrus.
- [ ] **API Key de Reseller:** Clave Bearer (`rsk_...`) con permisos de consulta, provisión y fondeo.
- [ ] **Receptor de Webhooks operativo:** Endpoint público de AstroAm activo (o un túnel local con Ngrok/Localtunnel apuntando a `POST /citrus/webhooks`) con `CITRUS_WEBHOOK_SECRET` configurado y verificado.
- [ ] **eSIM de prueba existente:** Una eSIM ya aprovisionada en la cuenta para realizar los fondeos de prueba (o posibilidad de aprovisionar una primera eSIM para el ciclo).
- [ ] **Saldo disponible inicial:** Contar con un saldo en Citrus superior al umbral a probar (ej. si el umbral se fijará en \$20 USD, contar con ~\$25–\$30 USD de saldo maestro).

---

## 3. Procedimiento Paso a Paso

```
┌────────────────────────────────────────────────────────────────────────┐
│ PASO 1: Configurar Auto-Refill en Dashboard                            │
│  - Threshold: $20 USD                                                  │
│  - Refill Amount: $100 USD (tarjeta Stripe activa)                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASO 2: Drenar saldo con POST /esim/{iccid}/fund                       │
│  - Fondear eSIM hasta que saldo maestro baje a < $20 USD              │
│  - Observar: NO debe haber cobro en Stripe aún                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASO 3: Ejecutar gasto real POST /esim/provision                       │
│  - Costo real: $1.75 USD                                               │
│  - Saldo maestro ya estaba por debajo del umbral                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASO 4: Observar cobro en Stripe y acreditación                        │
│  - Stripe cobra $100 USD                                               │
│  - Saldo reseller se incrementa a (Saldo previo - $1.75 + $100)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASO 5: Verificar Webhooks recibidos                                   │
│  - balance.auto_refill_succeeded (o balance.auto_refill_failed)        │
│  - Registro en JSONL y logs estructurados del backend                  │
└────────────────────────────────────────────────────────────────────────┘
```

### Paso 1: Configuración en el Dashboard de Citrus

1. Iniciar sesión en el portal de revendedores de Citrus Mobile.
2. Navegar a **Settings** > **Billing & Payments** (o **Wallet / Auto-Refill**).
3. Habilitar **Auto-Refill**:
   - **Low Balance Trigger / Threshold:** Configurar en **\$20.00 USD** (o \$50.00 USD si el saldo actual es más elevado).
   - **Refill Amount:** Configurar en **\$100.00 USD** (monto recomendado para diluir comisiones bancarias fijas y amortizar gastos de operación).
   - **Payment Method:** Seleccionar la tarjeta de crédito principal.
4. Asegurar que la URL del Webhook esté registrada en la sección **Webhooks**:
   - URL: `https://<tu-dominio-o-ngrok>/citrus/webhooks`
   - Eventos: Seleccionar `balance.*` y `esim.*` (o comodín `*`).
   - Copiar y resguardar el `signing_secret` (`whsec_...`).

### Paso 2: Drenar saldo de la cuenta reseller mediante tramos (`fund`)

El objetivo es reducir el saldo de la cuenta maestra por debajo del umbral de \$20.00 USD mediante transferencias internas a la wallet de una eSIM.

1. Consultar el saldo actual de la cuenta reseller:
   ```bash
   curl -s -X GET "https://citrusmobile.com/api/v2/reseller/wallet/balance" \
     -H "Authorization: Bearer $CITRUS_API_KEY"
   ```
   *Respuesta esperada:*
   ```json
   {
     "balance_usd": 27.50,
     "currency": "USD"
   }
   ```

2. Fondear la eSIM de prueba con los tramos necesarios para que el balance caiga por debajo de \$20.00 USD (por ejemplo, \$10.00 USD):
   ```bash
   curl -s -X POST "https://citrusmobile.com/api/v2/reseller/esim/89882.../fund" \
     -H "Authorization: Bearer $CITRUS_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"amount": 10.00}'
   ```

3. Verificar nuevamente el saldo reseller:
   ```bash
   curl -s -X GET "https://citrusmobile.com/api/v2/reseller/wallet/balance" \
     -H "Authorization: Bearer $CITRUS_API_KEY"
   ```
   *Respuesta esperada:*
   ```json
   {
     "balance_usd": 17.50,
     "currency": "USD"
   }
   ```

4. **Punto de verificación crítico:**
   - Ingresar a la app bancaria / portal de la tarjeta de crédito o al dashboard de Stripe.
   - **Constatar que NO se haya realizado ningún cargo en la tarjeta.**
   - Revisar los logs del backend de AstroAm: **No debe haber llegado ningún webhook de `balance.auto_refill_succeeded`**.

> [!NOTE]
> Esto confirma la hipótesis operativa: las transferencias a wallets de eSIMs no son computadas como eventos disparadores de auto-recarga por el motor de facturación de Citrus.

### Paso 3: Disparar el gasto real aprovisionando una eSIM (\$1.75 USD)

Con el saldo maestro en \$17.50 USD (por debajo del umbral configurado de \$20.00 USD), ejecutar la provisión de una eSIM real. Este acto representa un costo irrecuperable de \$1.75 USD debitado directamente como cobro de servicio por Citrus.

1. Ejecutar la llamada a la API:
   ```bash
   curl -s -X POST "https://citrusmobile.com/api/v2/reseller/esim/provision" \
     -H "Authorization: Bearer $CITRUS_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "label": "Test-AutoRefill-C4",
       "end_user_reference": "astroam-refill-test"
     }'
   ```

2. Guardar el ICCID devuelto en la respuesta para control de inventario.

### Paso 4: Observar el comportamiento de Auto-Refill y Stripe

Inmediatamente después de la respuesta de `POST /esim/provision`:

1. **Verificar el cargo bancario:**
   - Revisar alertas de la tarjeta o dashboard de Stripe.
   - ¿Se produjo un cargo por \$100.00 USD de Citrus Mobile?
2. **Consultar nuevamente el saldo en la API:**
   ```bash
   curl -s -X GET "https://citrusmobile.com/api/v2/reseller/wallet/balance" \
     -H "Authorization: Bearer $CITRUS_API_KEY"
   ```
   - Si la recarga funcionó: el saldo debe reflejar:
     $$\text{Saldo final} = 17.50 - 1.75 + 100.00 = 115.75\text{ USD}$$
   - Si la recarga **no** se activó: el saldo reflejará únicamente $15.75 USD.

### Paso 5: Inspección de Webhooks y Logs del Backend

Verificar en el servidor de AstroAm la recepción de los webhooks de Citrus.

#### Caso Exitoso: `balance.auto_refill_succeeded`
Citrus envía un webhook con payload similar a:
```json
{
  "id": "evt_refill_succ_123456",
  "event": "balance.auto_refill_succeeded",
  "created_at": "2026-10-06T15:00:00Z",
  "data": {
    "amount_usd": 100.00,
    "new_balance_usd": 115.75,
    "payment_method": "pm_card_visa_4242",
    "stripe_charge_id": "ch_3M..."
  }
}
```
- **Log esperado en AstroAm:**
  ```json
  {"level":"info","reason":"citrus_balance_refilled","event":"balance.auto_refill_succeeded","amountUsd":100,"newBalanceUsd":115.75}
  ```

#### Caso Fallido: `balance.auto_refill_failed`
Si la tarjeta rechaza el pago (fondos insuficientes en la tarjeta, bloqueo anti-fraude bancario):
```json
{
  "id": "evt_refill_fail_987654",
  "event": "balance.auto_refill_failed",
  "created_at": "2026-10-06T15:00:00Z",
  "data": {
    "amount_usd": 100.00,
    "current_balance_usd": 15.75,
    "failure_code": "card_declined",
    "failure_message": "Your card was declined."
  }
}
```
- **Alerta esperada en AstroAm:**
  ```json
  {"level":"error","reason":"citrus_auto_refill_failed","event":"balance.auto_refill_failed","message":"Auto-refill charge failed"}
  ```

> [!CAUTION]
> Cuando ocurre un `balance.auto_refill_failed`, **Citrus desactiva automáticamente la auto-recarga** para evitar reintentos continuos. Un operador humano debe ingresar al dashboard a reactivarla manualmente una vez solucionado el problema con el emisor de la tarjeta.

---

## 4. Desglose Económico de la Prueba

El costo real del experimento se divide en gasto devengado e incremento de saldo operativo:

| Concepto | Monto | Estado de los Fondos |
|---|---|---|
| Provisión de eSIM (`POST /esim/provision`) | **\$1.75 USD** | **Gasto real consumido** (costo de la prueba). La eSIM queda disponible para pruebas futuras. |
| Fondeo de eSIM (`POST /esim/{iccid}/fund`) | \$10.00 USD | **Recuperable**. Puede ejecutarse `POST /esim/{iccid}/defund` para reintegrar este saldo a la cuenta maestra (demora ~15 min). |
| Auto-recarga por Stripe | \$100.00 USD | **Patrimonio conservado**. Queda como crédito a favor en la cuenta de Citrus para operar misiones y consumir datos. |
| **Costo neto final de la prueba** | **\$1.75 USD** | Solo los \$1.75 de la eSIM son costo irrecuperable. |

---

## 5. Plantilla de Registro de Resultados de Prueba

Completar esta ficha una vez ejecutada la prueba con la tarjeta real:

```markdown
### Registro de Ejecución de Prueba C4

- **Fecha y Hora (UTC):** YYYY-MM-DD HH:MM:SS
- **Operador responsable:** [Nombre / Rol]
- **ID de Cuenta Citrus:** [Account ID / Email]
- **Últimos 4 dígitos de la tarjeta:** [**** 1234]

#### Parámetros Configurados
- Saldo inicial en cuenta: $____.__ USD
- Umbral de auto-recarga (Threshold): $____.__ USD
- Monto de recarga (Refill Amount): $____.__ USD

#### Resultados de la Secuencia
1. Saldo tras fondeos internos (sin provisión): $____.__ USD
   - ¿Se cobró la tarjeta en este punto?: [ SÍ / NO ]
2. ICCID de la eSIM provisionada: 89882...
   - Saldo inmediatamente tras provisión: $____.__ USD
3. Cobro en Stripe:
   - ¿Se disparó el cobro de auto-recarga?: [ SÍ / NO ]
   - ID de cargo Stripe / Transacción: ch_...
4. Webhooks recibidos en AstroAm:
   - Evento recibido: [ balance.auto_refill_succeeded / balance.auto_refill_failed / Ninguno ]
   - ID del evento: evt_...
   - Latencia aproximada desde la provisión: ____ segundos
5. Estado final de la cuenta de Citrus:
   - Saldo final disponible: $____.__ USD
   - Estado de auto-refill en dashboard: [ ACTIVO / DESACTIVADO ]

#### Conclusiones y Observaciones Operativas
- [Detallar anomalías, demoras inusuales o requerimientos bancarios 3D Secure si existieron]
```

---

## 6. Recomendaciones Operativas para Producción

1. **Mantener un umbral preventivo elevado en AstroAm:**  
   Debido a que Citrus puede tardar en reaccionar o depender de gastos reales, configurar en `.env`:
   ```env
   CITRUS_RESELLER_LOW_BALANCE_USD=50
   ```
   Esto asegura que el backend emita advertencias y frene la admisión de misiones antes de que la cuenta quede desprovista de fondos.
2. **Supervisión de `balance.auto_refill_failed`:**  
   Configurar una alerta con severidad crítica (PagerDuty, Telegram o Slack Ops) ante cualquier evento `balance.auto_refill_failed`.
3. **Reclamar fondos ociosos:**  
   Al finalizar cualquier sesión o prueba donde se fondearon eSIMs, invocar `POST /esim/{iccid}/defund` para reintegrar el saldo a la cuenta central.

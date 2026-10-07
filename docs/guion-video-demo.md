# Guión de Video Demo: AstroAm en Monad Testnet (Hito E5)

**Duración objetivo:** 2 minutos 45 segundos (Rango: 2:30 – 3:00)  
**Propósito:** Video de demostración oficial y pitch técnico para la entrega del hito **Metropolis Delivery Milestone** en Monad.  
**Formato visual:** Grabación de pantalla 16:9 con Picture-in-Picture (PiP) del presentador / celular, capturas en vivo de la dApp AstroAm, extensión/app de MetaMask y el explorador MonadVision.  
**Idioma principal:** Español (con transcripción / subtítulos en Inglés incluidos).  

---

## 1. Ficha Técnica y Recursos para la Grabación

| Aspecto | Especificación |
|---|---|
| **Resolución** | 1080p (1920x1080) a 60 fps |
| **Escenas requeridas** | 1. Diapositiva/Intro del problema · 2. dApp AstroAm (Desktop/Mobile) · 3. Interacción con MetaMask · 4. MonadVision Explorer · 5. Resumen tecnológico |
| **Contrato en Demo** | `AstroAmEscrow` v3: `0xe89893d51180e517e2bf175398aad2e6da82c0f9` |
| **Token en Demo** | Circle USDC (`0x534b2f3A21130d7a60830c2Df862319e593943A3`, 6 decimales) |
| **Red** | Monad Testnet (Chain ID 10143) |
| **Explorador** | `https://testnet.monadvision.com` |

---

## 2. Estructura y Cronograma Secuencial

```
  0:00                    0:30                                  1:15                                   2:00                                   2:45        3:00
   |-----------------------|-------------------------------------|--------------------------------------|--------------------------------------|-----------|
     PROBLEMA Y VISIÓN      RESERVA, METAMASK Y ESIM CITRUS       CABINA ACTIVA Y VALES EIP-712          END MISSION, MONADVISION Y REEMBOLSO   STACK & CIERRE
```

---

## 3. Guión Paso a Paso

---

### Acto 1: El Problema del Roaming y la Oportunidad en Web3 (0:00 – 0:30)

#### Visual en pantalla:
- **0:00 - 0:10:** B-roll dinámico de un viajero llegando a un aeropuerto internacional consultando su smartphone sin señal, seguido de capturas de tarifas exorbitantes de roaming internacional y planes de eSIM rígidos (paquetes cerrados de 10 GB donde el usuario usa 1 GB y pierde el resto).
- **0:10 - 0:20:** Animación conceptual: ¿Por qué Web3 no lo ha resuelto aún? Enviar una transacción on-chain por cada megabyte consumido significaría cientos de popups de MetaMask, esperas y comisiones de gas inmanejables.
- **0:20 - 0:30:** Aparece el logotipo animado de **AstroAm** con el tagline: *"Pay-as-you-go Global Connectivity powered by Monad EVM & Circle USDC"*.

#### Locución (Voz en off):
> **[ES]**  
> *"Viajar internacionalmente sigue siendo una pesadilla de conectividad: o pagas tarifas exorbitantes de roaming a tu operador tradicional, o compras costosos paquetes de eSIM fijos donde el 70% de tus datos expira sin usarse.*  
> *Hasta hoy, llevar esto a Web3 era inviable: ningún usuario quiere firmar una transacción en MetaMask por cada megabyte que consume en su viaje.*  
> *Presentamos AstroAm: la primera dApp de conectividad celular global pay-as-you-go en Monad, donde solo pagas exactamente por los megabytes que usas y el remanente regresa al instante a tu wallet."*

> **[EN Subtitles]**  
> *"International travel connectivity is broken: either extortionate roaming fees or rigid eSIM packages where unused data expires.*  
> *Bringing this to Web3 previously failed because signing a wallet transaction per megabyte is impossible UX.*  
> *Meet AstroAm: the first pay-as-you-go global cellular dApp on Monad, charging strictly for consumed megabytes with instant on-chain refunds."*

---

### Acto 2: Reserva, Depósito con MetaMask y Aprovisionamiento de eSIM (0:30 – 1:15)

#### Visual en pantalla:
- **0:30 - 0:42:** Pantalla principal de AstroAm (`localhost:5173` o app móvil). El usuario selecciona el destino: **Brasil 🇧🇷** (tarifa: `0.0025 USDC / MB`). Establece un presupuesto de **5.00 USDC** y presiona **"START MISSION"**.
- **0:42 - 0:58:** Pantalla de depósito. Se muestra el botón **"DEPOSIT & CONNECT"**. Se despliega el modal de **MetaMask Connect**.
  1. El usuario autoriza la conexión con Monad Testnet (Chain ID `10143`).
  2. Firma 1: `approve` de Circle USDC (5.00 USDC).
  3. Firma 2: `deposit` en el contrato inmutable `AstroAmEscrow` v3.
- **0:58 - 1:07:** Zoom al navegador / consola: se resalta gráficamente que, antes de depositar, la aplicación generó en el navegador una **Clave de Sesión (Session Key)** efímera (`generatePrivateKey()`) almacenada en `localStorage`, registrando su firmante público directamente en el escrow on-chain.
- **1:07 - 1:15:** La transacción de depósito se confirma en 1 segundo en Monad. La API de conectividad (**Citrus Mobile**) aprovisiona de inmediato la eSIM. En pantalla aparece el código QR listo para escanear y el enlace de instalación directa LPA.

#### Locución:
> **[ES]**  
> *"Veámoslo en acción. Seleccionamos nuestro destino, por ejemplo Brasil, a 0.0025 USDC por megabyte, y asignamos un depósito de 5 dólares con Circle USDC.*  
> *Conectamos nuestra billetera a través de MetaMask Connect en Monad Testnet. Confirmamos la aprobación de USDC y el depósito en nuestro contrato AstroAmEscrow.*  
> *Aquí ocurre la primera innovación: en el instante del depósito, la dApp genera localmente una clave de sesión criptográfica en el dispositivo y registra su dirección en el contrato.*  
> *¡Y listo! En menos de un segundo gracias al alto rendimiento de Monad, el contrato custodia los 5 USDC y la API de Citrus Mobile entrega nuestra eSIM lista para usar."*

> **[EN Subtitles]**  
> *"Let's see it live. We select Brazil at 0.0025 USDC per megabyte and set a 5 USDC deposit.*  
> *Connecting via MetaMask Connect on Monad Testnet, we confirm the USDC approval and escrow deposit.*  
> *Here is the first breakthrough: on deposit, the app locally generates a cryptographic session key and registers its signer on-chain.*  
> *In under a second thanks to Monad's speed, the escrow secures the 5 USDC and Citrus Mobile provisions our instant eSIM QR code."*

---

### Acto 3: Cabina en Vuelo: Consumo de Datos y Vales EIP-712 Silenciosos (1:15 – 2:00)

#### Visual en pantalla:
- **1:15 - 1:30:** Transición a la **Cabina de Misión ("Flight Cockpit")**. Interfaz futurista con telemetría en tiempo real: velocímetro de consumo de datos, saldo disponible en USDC y gráfico de tráfico en vivo.
- **1:30 - 1:45:** Se activa la simulación de tráfico real de datos consumiendo **250 MB**.
- **1:45 - 2:00:** Demostración de pantalla dividida:
  - Lado izquierdo: El medidor de MB sube fluidamente de 0 a 250 MB y el balance en la UI pasa de 5.00 USDC a 4.375 USDC disponibles.
  - Lado derecho: La ventana de MetaMask permanece completamente tranquila y en reposo. **¡Cero popups! ¡Cero solicitudes de firma!**
  - Gráfico animado superpuesto: Muestra cómo cada microbloque genera un vale EIP-712 firmado localmente por la Session Key fuera de la cadena (*off-chain*), enviado vía API al operador.

#### Locución:
> **[ES]**  
> *"Aterrizamos en nuestro destino y entramos a la cabina de vuelo de AstroAm. El usuario empieza a navegar, enviar mensajes y usar mapas.*  
> *Simulamos un consumo real de 250 megabytes. Miren con atención la pantalla: los datos corren, la telemetría se actualiza en tiempo real, pero MetaMask no interrumpe jamás.*  
> *No hay popups molestos ni gas quemado por cada megabyte. Gracias a los vales EIP-712 firmados silenciosamente por la clave de sesión local, logramos la fluidez de una aplicación Web2 con la seguridad soberana y descentralizada de Web3."*

> **[EN Subtitles]**  
> *"We land at our destination and open the AstroAm cockpit. The traveler browses, messages, and navigates.*  
> *We stream 250 megabytes of real data. Notice MetaMask: completely undisturbed. Zero popups, zero friction!*  
> *Through off-chain EIP-712 vouchers signed silently by the local session key, we deliver Web2-level seamlessness with true Web3 cryptographic guarantees."*

---

### Acto 4: Finalización del Viaje ("END MISSION"), MonadVision y Reembolso Atómico (2:00 – 2:45)

#### Visual en pantalla:
- **2:00 - 2:10:** El usuario termina su viaje y presiona el botón rojo **"END MISSION"** en la cabina.
- **2:10 - 2:20:** La pantalla muestra el estado *"Settling on Monad Testnet..."*. El backend de AstroAm toma el último vale firmado (por 250 MB = 0.625 USDC) y llama a la función `close()` en el contrato.
- **2:20 - 2:35:** Se abre en pantalla completa el explorador oficial **MonadVision** (`testnet.monadvision.com/tx/...`):
  - Estado: **Success**.
  - Pestaña *Token Transfers (ERC-20)* con zoom destacado:
    - **Transfer 1:** `0.625 USDC` desde Escrow hacia AstroAm Payee (`0xE3E38...`).
    - **Transfer 2:** `4.375 USDC` desde Escrow **directamente de regreso a la wallet del viajero (`0x4aB3...`)**.
- **2:35 - 2:45:** Se abre la extensión de MetaMask en la pestaña **Tokens → USDC**: el saldo del viajero refleja inmediatamente la recepción de los 4.375 USDC. En la dApp, el modal **"Mission Settled"** enseña: *"Paid: 0.625 USDC / Back to your wallet: 4.375 USDC"*.

#### Locución:
> **[ES]**  
> *"Nuestro viaje ha terminado. Pulsamos 'END MISSION'.*  
> *El operador toma el último vale acumulado de 250 megabytes y ejecuta la transacción close on-chain.*  
> *Vayamos directo al explorador MonadVision. Miren la magia de los contratos inteligentes: en una sola transacción atómica, el contrato transfiere 0.625 USDC al operador por el servicio consumido, y devuelve automáticamente 4.375 USDC de excedente a la billetera del viajero.*  
> *Abrimos MetaMask: el reembolso de 4.375 USDC ya está acreditado en Tokens USDC. Sin trámites de soporte, sin esperar 30 días, sin perder un solo centavo."*

> **[EN Subtitles]**  
> *"The trip is complete. We hit 'END MISSION'.*  
> *The operator submits the final 250 MB voucher and executes the on-chain close call.*  
> *In MonadVision Explorer, witness smart contract atomicity: in one single transaction, 0.625 USDC goes to the operator, and 4.375 USDC is automatically refunded to the traveler's wallet.*  
> *In MetaMask, the 4.375 USDC is already in our balance. No support tickets, no 30-day waiting period, zero wasted dollars."*

---

### Acto 5: Stack Tecnológico, Arquitectura y Cierre (2:45 – 3:00)

#### Visual en pantalla:
- **2:45 - 2:55:** Tarjeta visual con la arquitectura y los pilares tecnológicos del proyecto:
  - **Monad EVM:** Alto throughput (10,000 TPS), finalidad de 1 segundo y tarifas mínimas de gas.
  - **Circle USDC:** Moneda de liquidación global, estable y transparente.
  - **Citrus Mobile:** Infraestructura de telecomunicaciones de grado telco con cobertura en más de 150 países.
  - **EIP-712 Session Keys:** Criptografía cliente para micropagos sin fricción.
- **2:55 - 3:00:** Pantalla final de cierre con el logo de AstroAm, enlaces al repositorio GitHub, MonadVision y llamada al jurado de Monad Metropolis.

#### Locución:
> **[ES]**  
> *"AstroAm une la potencia de 10,000 transacciones por segundo de Monad con la red de telecomunicaciones global de Citrus y la solidez de Circle USDC.*  
> *El roaming móvil por fin tiene el modelo económico y la experiencia de usuario que merecía.*  
> *Gracias al equipo de Monad y bienvenidos al futuro de la conectividad descentralizada con AstroAm."*

> **[EN Subtitles]**  
> *"AstroAm pairs Monad's 10,000 TPS performance with Citrus Mobile's telco infrastructure and Circle USDC stability.*  
> *Mobile roaming finally has the fair business model and friction-free UX it always deserved.*  
> *Thank you Monad team, and welcome to the decentralized future of connectivity with AstroAm."*

---

## 4. Checklist de Producción Previa a la Grabación

- [ ] Navegador limpio con marcadores a:
  - dApp AstroAm (`http://localhost:5173`)
  - Explorador MonadVision (`https://testnet.monadvision.com`)
  - Faucet de Circle / Monad
- [ ] MetaMask configurado con:
  - Red Monad Testnet (Chain ID 10143)
  - Saldo de MON para gas (~2+ MON)
  - Saldo de Circle USDC (~10+ USDC)
  - Token USDC agregado en la pestaña Tokens (`0x534b2f3A21130d7a60830c2Df862319e593943A3`)
- [ ] Backend levantado con contrato v3 (`0xe89893d51180e517e2bf175398aad2e6da82c0f9`) y payee configurado en `.env`.
- [ ] Resolución de grabación ajustada a 1920x1080 con audio de micrófono limpio y sin eco.

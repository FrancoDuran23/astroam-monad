# Guía Operativa de Pruebas en Celular con MetaMask Connect (Monad Testnet)

Esta guía detalla paso a paso cómo probar el flujo completo de AstroAm desde un dispositivo móvil (iOS / Android) usando **MetaMask Connect** (`@metamask/connect-evm`) sobre **Monad Testnet**, cubriendo desde la exposición de red hasta la firma de vales sin popups y el reembolso final.

---

## 1. Arquitectura del Flujo Móvil

El flujo en celular opera de la siguiente manera:

1. **MetaMask Connect (`@metamask/connect-evm`)**:
   - En navegadores móviles (Safari en iOS, Chrome en Android), la dApp se comunica con MetaMask a través de un canal de emparejamiento.
   - Al requerir interacción (conexión o firma de transacciones on-chain), se activa un **deeplink** (`metamask://...`) que abre la aplicación móvil de MetaMask.
2. **Dos transacciones iniciales en MetaMask**:
   - **Paso 1: `approve` de USDC**: Otorga permiso al contrato de escrow (`AstroAmEscrow`) para debitar el monto del depósito.
   - **Paso 2: `deposit` en Escrow**: Transfiere los USDC al escrow y registra la dirección pública de un firmante de sesión (*Session Signer*).
3. **Clave de sesión en el navegador (`localStorage`)**:
   - Antes de depositar, el navegador móvil genera criptográficamente una clave privada de sesión (`generatePrivateKey()` de `viem`).
   - Esta clave se almacena en el almacenamiento local del navegador (`astroam_session_<missionId>`).
4. **Cabina activa (Cockpit) y vales EIP-712**:
   - Durante el consumo de datos móviles, el navegador firma vales de uso acumulado vía EIP-712 en segundo plano usando su clave de sesión local.
   - **No hay popups ni saltos a MetaMask por cada MB consumido**.
5. **Cierre y Reembolso**:
   - Al finalizar el viaje, el backend ejecuta la liquidación final on-chain con el último vale firmado; los USDC no consumidos se reembolsan inmediatamente a la billetera MetaMask del viajero.

---

## 2. Requisitos Previos

### En el Celular
- **App de MetaMask instalada**: Descargada desde App Store (iOS) o Google Play Store (Android).
- **Red Monad Testnet agregada en MetaMask**:
  - **Nombre de red**: `Monad Testnet`
  - **RPC URL**: `https://testnet-rpc.monad.xyz`
  - **Chain ID**: `10143`
  - **Símbolo**: `MON`
  - **Explorador**: `https://testnet.monadvision.com`
- **Fondos de prueba en la cuenta del viajero**:
  - **MON para gas**: Obtener en el faucet oficial: [faucet.monad.xyz](https://faucet.monad.xyz).
  - **USDC de prueba (Circle)**: Obtener en [faucet.circle.com](https://faucet.circle.com) seleccionando **Monad Testnet**.
  - **Dirección del contrato USDC**: `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimales). Si no aparece en la app, agregarlo con *Importar tokens* → *Token personalizado*.

### En la PC de Desarrollo
- Repositorio con backend y frontend instalados (`npm install` en raíz y en `frontend/`).
- Archivo `.env` configurado con el contrato de escrow y el riel Monad (`PAYMENT_RAIL=monad`, `MONAD_ESCROW_ADDRESS`, `MONAD_PAYEE_PRIVATE_KEY`).

---

## 3. Preparación de Red: Exponer el Frontend al Celular

El navegador del celular no puede acceder a `localhost`. Existen dos métodos:

### Opción A: Misma Red Wi-Fi (IP Local / LAN) — *Recomendada si estás en la misma Wi-Fi*

1. **Obtener la dirección IP local de tu PC**:
   - **Windows**: Abre PowerShell o CMD y ejecuta:
     ```powershell
     ipconfig
     ```
     Busca el adaptador Wi-Fi activo y copia la **Dirección IPv4** (ejemplo: `192.168.1.45`).
   - **macOS / Linux**:
     ```bash
     ifconfig | grep "inet "
     # o bien:
     ip -4 addr show
     ```

2. **Configurar el backend (`.env`)**:
   El backend soporta múltiples orígenes CORS separados por coma. Agrega la IP local de tu frontend a `FRONTEND_ORIGIN`:
   ```env
   FRONTEND_ORIGIN=http://localhost:5173,http://192.168.1.45:5173
   ```
   *(Reemplaza `192.168.1.45` por tu IP real).*

3. **Iniciar los servicios**:
   - **Backend**:
     ```bash
     npm run server
     ```
     *(Escucha en el puerto `8080`).*
   - **Frontend**:
     ```bash
     cd frontend
     npm run dev
     ```
     *(Vite está configurado con `server.host: true` en `vite.config.ts`, por lo que escuchará en `0.0.0.0:5173` y mostrará la URL de red en la consola):*
     ```text
       ➜  Local:   http://localhost:5173/
       ➜  Network: http://192.168.1.45:5173/
     ```

4. **Conectar el celular a la misma red Wi-Fi**:
   - Abre el navegador del celular (Safari en iOS o Chrome en Android) e ingresa a `http://192.168.1.45:5173`.
   - *Nota sobre Firewall de Windows*: Si la página no carga en el celular, verifica que el Firewall de Windows no esté bloqueando Node.js en redes privadas o permite el puerto entrante 5173.

---

### Opción B: Túnel HTTPS (Cloudflare / Ngrok) — *Recomendada si usas datos móviles 4G/5G o si tu Wi-Fi tiene aislamiento*

Si tu Wi-Fi tiene aislamiento de clientes (común en redes de oficina/cafés) o si el celular usa datos móviles, utiliza un túnel HTTPS. Además, un túnel HTTPS garantiza un contexto seguro (`HTTPS`) nativo para APIs web del celular.

#### Opción B.1 con Cloudflare Tunnel (Sin cuenta requerida, gratis e instantáneo)
En una terminal en tu PC, ejecuta:
```bash
npx cloudflared tunnel --url http://localhost:5173
```
Cloudflare generará una URL pública segura como `https://random-subdomain.trycloudflare.com`.

#### Opción B.2 con Ngrok
```bash
ngrok http 5173
```
Ngrok generará una URL como `https://abc-123.ngrok-free.app`.

#### Configuración de `.env` para el túnel:
Agrega la URL generada al archivo `.env`:
```env
FRONTEND_ORIGIN=http://localhost:5173,https://random-subdomain.trycloudflare.com
```
Reinicia el backend si ya estaba corriendo.

---

## 4. Guía de Ejecución del Flujo en el Celular

Sigue este paso a paso detallado para validar la experiencia de usuario:

### Paso 1: Acceso a la dApp
- Abre el navegador en tu celular (Safari en iOS, Chrome en Android) y visita la URL (`http://<IP_LOCAL>:5173` o la URL del túnel HTTPS).
- Verifica que cargue la interfaz espacial de AstroAm con el saludo de cabina y la lista de destinos.

### Paso 2: Selección de Destino y Presupuesto
- Selecciona un destino (por ejemplo, Brasil 🇧🇷 o Estados Unidos 🇺🇸).
- Define las fechas y el presupuesto en USDC (ej. 10 USDC).
- Presiona **"START MISSION"** para crear la misión en el backend.

### Paso 3: Pantalla de Depósito y Conexión de MetaMask
- Verás el resumen con los 3 pasos:
  1. `Approve X.XX USDC on Monad Testnet`
  2. `Deposit it into your trip escrow`
  3. `Session key generation (no popups per MB)`
- Pulsa el botón principal **"DEPOSIT & CONNECT"**.

### Paso 4: Deeplink a MetaMask Móvil
- El modal de MetaMask Connect se activará:
  - En celular, presentará la opción de abrir la aplicación MetaMask mediante deeplink.
  - Toca para abrir MetaMask. El sistema operativo abrirá la app móvil de MetaMask.
- En MetaMask:
  - Si tu billetera está en otra red (ej. Ethereum Mainnet o Sepolia), MetaMask solicitará agregar/cambiar a **Monad Testnet**. Confirma el cambio.
  - Se solicitará conectar tu cuenta con el dApp AstroAm. Confirma la conexión.

### Paso 5: Aprobación de USDC (`approve`)
- Una vez conectada, MetaMask mostrará la solicitud de transacción de **Aprobación de gasto de USDC**.
- Revisa el monto y presiona **"Confirmar"**.
- *Nota de UX en celulares*: Tras presionar confirmar, regresa al navegador (usando el botón superior de regreso o el selector de aplicaciones). El frontend mostrará el estado `"Approving USDC in your wallet…"`.

### Paso 6: Depósito en el Escrow (`deposit`)
- Al confirmarse el `approve` on-chain, el frontend pasará automáticamente al paso de depósito y solicitará la segunda transacción.
- Vuelve a MetaMask (o MetaMask se abrirá por deeplink) para firmar la llamada a `deposit(escrowId, amount, sessionSigner)`.
- Revisa la tarifa de gas (en MON) y presiona **"Confirmar"**.
- Regresa al navegador. Verás el indicador `"Waiting for Monad…"`.

### Paso 7: Activación y Verificación de Clave de Sesión
- Tan pronto como la transacción de depósito se confirma en el bloque de Monad, el frontend envía el hash al backend (`POST /api/missions/:id/payment-confirmation`).
- El backend valida el depósito on-chain y transiciona la misión a estado `active`.
- **Verificación de la Clave de Sesión**:
  - En las herramientas de desarrollador o en el comportamiento del navegador, la clave privada de sesión y la dirección del firmante ya están almacenadas en `localStorage` bajo `astroam_session_<missionId>`.
  - La pantalla pasa automáticamente a la **Cabina de Misión ("Flight in progress")**.

### Paso 8: Simulación de Consumo en Cabina (Cockpit)
- En la cabina activa del celular:
  - Verás el velocímetro de telemetría, el consumo acumulado de MB y el saldo disponible.
- Presiona **"Simulate Traffic"** o **"Inject 100 MB"**:
  - El frontend utiliza la clave de sesión local para firmar los vales EIP-712 sin requerir **ningún popup de MetaMask**.
  - El saldo se actualiza fluidamente en la interfaz móvil.

### Paso 9: Cierre del Viaje y Reembolso
- Presiona **"Finish Trip"** (o solicita el cierre desde el backend / interfaz).
- El backend toma el último vale firmado, cierra el canal en el contrato de escrow (`close(escrowId, cumulativeAmount, signature)`), transfiere el costo real al operador y **reembolsa el saldo no consumido al viajero**.
- Abre tu app de MetaMask en el celular y ve a la pestaña de Tokens:
  - Confirma que el balance de USDC se incrementó con el reembolso del sobrante.

---

## 5. Casos de Borde, Limitaciones Conocidas y Solución de Problemas

### 1. Retorno de Deeplink entre MetaMask y el Navegador
- **Comportamiento**: Cuando MetaMask procesa una firma o transacción en iOS/Android, los deeplinks estándar no regresan automáticamente al navegador por restricciones de seguridad del sistema operativo.
- **Acción requerida**: El usuario debe tocar el enlace de regreso en la barra de estado (ejemplo: `< Safari` en la esquina superior izquierda de iOS) o utilizar el cambiador de aplicaciones para volver a la pestaña de AstroAm.
- **Diseño defensivo de AstroAm**: La interfaz mantiene el estado en progreso (`"Approving USDC..."` / `"Waiting for Monad..."`) y consulta el RPC con `waitForTransactionReceipt`, por lo que cuando el usuario regresa a la pestaña, el avance no se pierde.

### 2. Bloqueo de Conexión por CORS
- **Síntoma**: La página carga en el celular pero las llamadas a `/api/...` fallan con error de red o consola indicando `Cross-Origin Request Blocked`.
- **Causa**: El backend no tiene registrada la IP o dominio del celular en `FRONTEND_ORIGIN`.
- **Solución**:
  - Verifica que en el archivo `.env` de la raíz esté configurado:
    ```env
    FRONTEND_ORIGIN=http://localhost:5173,http://<TU_IP_LOCAL>:5173
    ```
  - Si estás en modo demo/desarrollo (`ASTROAM_LIVE_ENABLED=false`), también puedes configurar temporalmente:
    ```env
    FRONTEND_ORIGIN=*
    ```
  - Reinicia el servidor backend (`npm run server`).

### 3. Error "Insufficient funds for gas" o "This wallet has no MON"
- **Causa**: La billetera en el celular no tiene MON nativo en Monad Testnet para pagar las tarifas de red.
- **Solución**: Solicita MON en [faucet.monad.xyz](https://faucet.monad.xyz) usando la dirección de tu cuenta de MetaMask móvil.

### 4. Error "Allowance short" o rechazo en MetaMask (código 4001)
- **Causa**: El usuario rechazó la transacción en MetaMask o cerró la app sin firmar.
- **Solución**: El botón en pantalla vuelve al estado habilitado con el mensaje `"You rejected the request in MetaMask."` y permite reintentar el pago sin recargar la página.

### 5. Borrado accidental de datos de navegación (`localStorage`)
- **Impacto**: Si el usuario borra la caché o datos del sitio en el navegador del celular a mitad del viaje, la clave de sesión privada local se pierde.
- **Protección del sistema**: El contrato protege al usuario; solo se podrá cobrar hasta el último vale firmado previamente y aceptado por el backend. Los fondos restantes quedan a salvo en el escrow y se devuelven al cerrar la misión o al vencer el timeout de seguridad.

### 6. Alternativa: Navegador Integrado de MetaMask (In-App Browser)
- Si los deeplinks del navegador nativo de tu dispositivo tienen conflicto o el sistema operativo cierra la pestaña en segundo plano:
  1. Abre la app de **MetaMask** en el celular.
  2. Toca el ícono de **Navegador** en la barra inferior de MetaMask.
  3. Ingresa la URL (`http://<IP_LOCAL>:5173` o la URL de túnel HTTPS).
  4. En este entorno, MetaMask inyecta `window.ethereum` directamente en el navegador interno, por lo que las firmas y confirmaciones ocurren en la misma pantalla sin necesidad de saltar entre aplicaciones.

---

## 6. Lista de Verificación (Checklist de Prueba Exitosa)

- [ ] Vite muestra la URL de red (`Network: http://...:5173`) gracias a `server.host: true`.
- [ ] Backend permite la IP o túnel a través de `FRONTEND_ORIGIN`.
- [ ] La dApp abre en el celular y permite seleccionar destino y crear misión.
- [ ] Deeplink abre MetaMask móvil y solicita cambio de red a Monad Testnet (10143) si es necesario.
- [ ] Transacción 1 (`approve` USDC) se confirma con éxito.
- [ ] Transacción 2 (`deposit` Escrow) se confirma con éxito.
- [ ] La dApp en el celular transiciona a la cabina activa con clave de sesión guardada.
- [ ] La simulación de consumo firma vales sin abrir la app de MetaMask.
- [ ] El cierre reembolsa los USDC sobrantes a la cuenta móvil en Monad Testnet.

# Operating Guide for Phone Testing with MetaMask Connect (Monad Testnet)

This guide details step by step how to test the complete AstroAm flow from a mobile device (iOS / Android) using **MetaMask Connect** (`@metamask/connect-evm`) on **Monad Testnet**, covering everything from exposing the network to signing vouchers without popups and the final refund.

---

## 1. Architecture of the Mobile Flow

The flow on a phone works as follows:

1. **MetaMask Connect (`@metamask/connect-evm`)**:
   - In mobile browsers (Safari on iOS, Chrome on Android), the dApp communicates with MetaMask through a pairing channel.
   - When interaction is required (connection or signing on-chain transactions), a **deeplink** (`metamask://...`) is triggered that opens the MetaMask mobile app.
2. **Two initial transactions in MetaMask**:
   - **Step 1: USDC `approve`**: Grants permission to the escrow contract (`AstroAmEscrow`) to debit the deposit amount.
   - **Step 2: `deposit` into Escrow**: Transfers the USDC to the escrow and registers the public address of a session signer (*Session Signer*).
3. **Session key in the browser (`localStorage`)**:
   - Before depositing, the mobile browser cryptographically generates a session private key (`generatePrivateKey()` from `viem`).
   - This key is stored in the browser's local storage (`astroam_session_<missionId>`).
4. **Active cockpit (Cockpit) and EIP-712 vouchers**:
   - During mobile data usage, the browser signs cumulative usage vouchers via EIP-712 in the background using its local session key.
   - **There are no popups or jumps to MetaMask for each MB consumed**.
5. **Close and Refund**:
   - When the trip ends, the backend executes the final on-chain settlement with the last signed voucher; the unconsumed USDC is immediately refunded to the traveler's MetaMask wallet.

---

## 2. Prerequisites

### On the Phone
- **MetaMask app installed**: Downloaded from the App Store (iOS) or Google Play Store (Android).
- **Monad Testnet network added in MetaMask**:
  - **Network name**: `Monad Testnet`
  - **RPC URL**: `https://testnet-rpc.monad.xyz`
  - **Chain ID**: `10143`
  - **Symbol**: `MON`
  - **Explorer**: `https://testnet.monadvision.com`
- **Test funds in the traveler's account**:
  - **MON for gas**: Get it at the official faucet: [faucet.monad.xyz](https://faucet.monad.xyz).
  - **Test USDC (Circle)**: Get it at [faucet.circle.com](https://faucet.circle.com) selecting **Monad Testnet**.
  - **USDC contract address**: `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals). If it does not appear in the app, add it with *Import tokens* → *Custom token*.

### On the Development PC
- Repository with the backend and frontend installed (`npm install` at the root and in `frontend/`).
- `.env` file configured with the escrow contract and the Monad rail (`PAYMENT_RAIL=monad`, `MONAD_ESCROW_ADDRESS`, `MONAD_OPERATOR_PRIVATE_KEY`).

---

## 3. Network Preparation: Exposing the Frontend to the Phone

The phone's browser cannot access `localhost`. There are two methods:

### Option A: Same Wi-Fi Network (Local IP / LAN) — *Recommended if you are on the same Wi-Fi*

1. **Get your PC's local IP address**:
   - **Windows**: Open PowerShell or CMD and run:
     ```powershell
     ipconfig
     ```
     Find the active Wi-Fi adapter and copy the **IPv4 Address** (example: `192.168.1.45`).
   - **macOS / Linux**:
     ```bash
     ifconfig | grep "inet "
     # or:
     ip -4 addr show
     ```

2. **Configure the backend (`.env`)**:
   The backend supports multiple CORS origins separated by commas. Add your frontend's local IP to `FRONTEND_ORIGIN`:
   ```env
   FRONTEND_ORIGIN=http://localhost:5173,http://192.168.1.45:5173
   ```
   *(Replace `192.168.1.45` with your real IP).*

3. **Start the services**:
   - **Backend**:
     ```bash
     npm run server
     ```
     *(Listens on port `8080`).*
   - **Frontend**:
     ```bash
     cd frontend
     npm run dev
     ```
     *(Vite is configured with `server.host: true` in `vite.config.ts`, so it will listen on `0.0.0.0:5173` and show the network URL in the console):*
     ```text
       ➜  Local:   http://localhost:5173/
       ➜  Network: http://192.168.1.45:5173/
     ```

4. **Connect the phone to the same Wi-Fi network**:
   - Open the phone's browser (Safari on iOS or Chrome on Android) and go to `http://192.168.1.45:5173`.
   - *Note about the Windows Firewall*: If the page does not load on the phone, check that the Windows Firewall is not blocking Node.js on private networks or allow incoming port 5173.

---

### Option B: HTTPS Tunnel (Cloudflare / Ngrok) — *Recommended if you use 4G/5G mobile data or if your Wi-Fi has isolation*

If your Wi-Fi has client isolation (common in office/coffee-shop networks) or if the phone uses mobile data, use an HTTPS tunnel. In addition, an HTTPS tunnel guarantees a native secure context (`HTTPS`) for the phone's web APIs.

#### Option B.1 with Cloudflare Tunnel (No account required, free and instant)
In a terminal on your PC, run:
```bash
npx cloudflared tunnel --url http://localhost:5173
```
Cloudflare will generate a secure public URL such as `https://random-subdomain.trycloudflare.com`.

#### Option B.2 with Ngrok
```bash
ngrok http 5173
```
Ngrok will generate a URL such as `https://abc-123.ngrok-free.app`.

#### `.env` configuration for the tunnel:
Add the generated URL to the `.env` file:
```env
FRONTEND_ORIGIN=http://localhost:5173,https://random-subdomain.trycloudflare.com
```
Restart the backend if it was already running.

---

## 4. Guide to Running the Flow on the Phone

Follow this detailed step-by-step to validate the user experience:

### Step 1: Access the dApp
- Open the browser on your phone (Safari on iOS, Chrome on Android) and visit the URL (`http://<LOCAL_IP>:5173` or the HTTPS tunnel URL).
- Verify that the AstroAm space interface loads with the cockpit greeting and the list of destinations.

### Step 2: Destination and Budget Selection
- Select a destination (for example, Brazil 🇧🇷 or United States 🇺🇸).
- Set the dates and the budget in USDC (e.g. 10 USDC).
- Press **"START MISSION"** to create the mission in the backend.

### Step 3: Deposit Screen and MetaMask Connection
- You will see the summary with the 3 steps:
  1. `Approve X.XX USDC on Monad Testnet`
  2. `Deposit it into your trip escrow`
  3. `Session key generation (no popups per MB)`
- Tap the main button **"DEPOSIT & CONNECT"**.

### Step 4: Deeplink to MetaMask Mobile
- The MetaMask Connect modal will activate:
  - On a phone, it will present the option to open the MetaMask application through a deeplink.
  - Tap to open MetaMask. The operating system will open the MetaMask mobile app.
- In MetaMask:
  - If your wallet is on another network (e.g. Ethereum Mainnet or Sepolia), MetaMask will ask to add/switch to **Monad Testnet**. Confirm the switch.
  - It will ask to connect your account with the AstroAm dApp. Confirm the connection.

### Step 5: USDC Approval (`approve`)
- Once connected, MetaMask will show the **USDC spending approval** transaction request.
- Review the amount and press **"Confirm"**.
- *UX note on phones*: After pressing confirm, return to the browser (using the top back button or the app switcher). The frontend will show the state `"Approving USDC in your wallet…"`.

### Step 6: Deposit into the Escrow (`deposit`)
- When the `approve` is confirmed on-chain, the frontend will automatically move on to the deposit step and request the second transaction.
- Go back to MetaMask (or MetaMask will open through a deeplink) to sign the call to `deposit(escrowId, amount, sessionSigner)`.
- Review the gas fee (in MON) and press **"Confirm"**.
- Return to the browser. You will see the indicator `"Waiting for Monad…"`.

### Step 7: Activation and Session Key Verification
- As soon as the deposit transaction is confirmed in the Monad block, the frontend sends the hash to the backend (`POST /api/missions/:id/payment-confirmation`).
- The backend validates the deposit on-chain and moves the mission to the `active` state.
- **Session Key Verification**:
  - In the developer tools or in the browser's behavior, the session private key and the signer address are already stored in `localStorage` under `astroam_session_<missionId>`.
  - The screen automatically moves to the **Mission Cockpit ("Flight in progress")**.

### Step 8: Usage Simulation in the Cockpit
- In the active cockpit on the phone:
  - You will see the telemetry speedometer, the accumulated MB consumption and the available balance.
- Press **"Simulate Traffic"** or **"Inject 100 MB"**:
  - The frontend uses the local session key to sign the EIP-712 vouchers without requiring **any MetaMask popup**.
  - The balance updates smoothly in the mobile interface.

### Step 9: Trip Close and Refund
- Press **"Finish Trip"** (or request the close from the backend / interface).
- The backend takes the last signed voucher, closes the channel in the escrow contract (`close(escrowId, cumulativeAmount, signature)`), transfers the real cost to the operator and **refunds the unconsumed balance to the traveler**.
- Open your MetaMask app on the phone and go to the Tokens tab:
  - Confirm that the USDC balance increased with the refund of the remainder.

---

## 5. Edge Cases, Known Limitations and Troubleshooting

### 1. Deeplink Return between MetaMask and the Browser
- **Behavior**: When MetaMask processes a signature or transaction on iOS/Android, standard deeplinks do not automatically return to the browser because of operating system security restrictions.
- **Required action**: The user must tap the return link in the status bar (example: `< Safari` in the top left corner of iOS) or use the app switcher to go back to the AstroAm tab.
- **AstroAm's defensive design**: The interface keeps the in-progress state (`"Approving USDC..."` / `"Waiting for Monad..."`) and queries the RPC with `waitForTransactionReceipt`, so when the user returns to the tab, the progress is not lost.

### 2. Connection Blocked by CORS
- **Symptom**: The page loads on the phone but the calls to `/api/...` fail with a network error or a console message indicating `Cross-Origin Request Blocked`.
- **Cause**: The backend does not have the phone's IP or domain registered in `FRONTEND_ORIGIN`.
- **Solution**:
  - Check that the `.env` file at the root has this configured:
    ```env
    FRONTEND_ORIGIN=http://localhost:5173,http://<YOUR_LOCAL_IP>:5173
    ```
  - If you are in demo/development mode (`ASTROAM_LIVE_ENABLED=false`), you can also temporarily set:
    ```env
    FRONTEND_ORIGIN=*
    ```
  - Restart the backend server (`npm run server`).

### 3. Error "Insufficient funds for gas" or "This wallet has no MON"
- **Cause**: The wallet on the phone does not have native MON on Monad Testnet to pay the network fees.
- **Solution**: Request MON at [faucet.monad.xyz](https://faucet.monad.xyz) using the address of your mobile MetaMask account.

### 4. Error "Allowance short" or rejection in MetaMask (code 4001)
- **Cause**: The user rejected the transaction in MetaMask or closed the app without signing.
- **Solution**: The on-screen button returns to the enabled state with the message `"You rejected the request in MetaMask."` and allows retrying the payment without reloading the page.

### 5. Accidental Deletion of Browsing Data (`localStorage`)
- **Impact**: If the user clears the cache or site data in the phone's browser in the middle of the trip, the local private session key is lost.
- **System protection**: The contract protects the user; only up to the last voucher previously signed and accepted by the backend can be collected. The remaining funds are safe in the escrow and are returned when the mission is closed or when the security timeout expires.

### 6. Alternative: MetaMask's Built-in Browser (In-App Browser)
- If the deeplinks of your device's native browser conflict or the operating system closes the tab in the background:
  1. Open the **MetaMask** app on the phone.
  2. Tap the **Browser** icon in MetaMask's bottom bar.
  3. Enter the URL (`http://<LOCAL_IP>:5173` or the HTTPS tunnel URL).
  4. In this environment, MetaMask injects `window.ethereum` directly into the internal browser, so signatures and confirmations happen on the same screen without needing to jump between applications.

---

## 6. Checklist (Successful Test Checklist)

- [ ] Vite shows the network URL (`Network: http://...:5173`) thanks to `server.host: true`.
- [ ] The backend allows the IP or tunnel through `FRONTEND_ORIGIN`.
- [ ] The dApp opens on the phone and allows selecting a destination and creating a mission.
- [ ] The deeplink opens MetaMask mobile and asks to switch network to Monad Testnet (10143) if necessary.
- [ ] Transaction 1 (USDC `approve`) is confirmed successfully.
- [ ] Transaction 2 (Escrow `deposit`) is confirmed successfully.
- [ ] The dApp on the phone moves to the active cockpit with the session key saved.
- [ ] The usage simulation signs vouchers without opening the MetaMask app.
- [ ] The close refunds the leftover USDC to the mobile account on Monad Testnet.

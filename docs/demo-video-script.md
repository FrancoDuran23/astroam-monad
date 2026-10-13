# Demo Video Script: AstroAm on Monad Testnet (Milestone E5)

**Target duration:** 2 minutes 45 seconds (Range: 2:30 – 3:00)  
**Purpose:** Official demo video and technical pitch for the delivery of the **Metropolis Delivery Milestone** on Monad.  
**Visual format:** 16:9 screen recording with Picture-in-Picture (PiP) of the presenter / phone, live captures of the AstroAm dApp, the MetaMask extension/app and the MonadVision explorer.  
**Main language:** Spanish (with English transcript / subtitles included). The Spanish narration blocks below, labeled **[ES]**, are given here in English translation.  

---

## 1. Technical Sheet and Recording Resources

| Aspect | Specification |
|---|---|
| **Resolution** | 1080p (1920x1080) at 60 fps |
| **Required scenes** | 1. Slide/Intro of the problem · 2. AstroAm dApp (Desktop/Mobile) · 3. MetaMask interaction · 4. MonadVision Explorer · 5. Technology summary |
| **Contract in Demo** | `AstroAmEscrow` v3: `0xe89893d51180e517e2bf175398aad2e6da82c0f9` |
| **Token in Demo** | Circle USDC (`0x534b2f3A21130d7a60830c2Df862319e593943A3`, 6 decimals) |
| **Network** | Monad Testnet (Chain ID 10143) |
| **Explorer** | `https://testnet.monadvision.com` |

---

## 2. Structure and Sequential Timeline

```
  0:00                    0:30                                  1:15                                   2:00                                   2:45        3:00
   |-----------------------|-------------------------------------|--------------------------------------|--------------------------------------|-----------|
     PROBLEM AND VISION     BOOKING, METAMASK AND CITRUS ESIM     ACTIVE COCKPIT AND EIP-712 VOUCHERS    END MISSION, MONADVISION AND REFUND    STACK & CLOSE
```

---

## 3. Step-by-Step Script

---

### Act 1: The Roaming Problem and the Web3 Opportunity (0:00 – 0:30)

#### On-screen visual:
- **0:00 - 0:10:** Dynamic B-roll of a traveler arriving at an international airport checking their smartphone with no signal, followed by captures of exorbitant international roaming rates and rigid eSIM plans (closed 10 GB packages where the user uses 1 GB and loses the rest).
- **0:10 - 0:20:** Conceptual animation: Why hasn't Web3 solved this yet? Sending an on-chain transaction for every megabyte consumed would mean hundreds of MetaMask popups, waits and unmanageable gas fees.
- **0:20 - 0:30:** The animated **AstroAm** logo appears with the tagline: *"Pay-as-you-go Global Connectivity powered by Monad EVM & Circle USDC"*.

#### Voice-over:
> **[ES]**  
> *"Traveling internationally is still a connectivity nightmare: either you pay exorbitant roaming rates to your traditional carrier, or you buy costly fixed eSIM packages where 70% of your data expires unused.*  
> *Until today, bringing this to Web3 was unviable: no user wants to sign a transaction in MetaMask for every megabyte they consume on their trip.*  
> *We present AstroAm: the first pay-as-you-go global cellular connectivity dApp on Monad, where you pay exactly for the megabytes you use and the remainder returns instantly to your wallet."*

> **[EN Subtitles]**  
> *"International travel connectivity is broken: either extortionate roaming fees or rigid eSIM packages where unused data expires.*  
> *Bringing this to Web3 previously failed because signing a wallet transaction per megabyte is impossible UX.*  
> *Meet AstroAm: the first pay-as-you-go global cellular dApp on Monad, charging strictly for consumed megabytes with instant on-chain refunds."*

---

### Act 2: Booking, Deposit with MetaMask and eSIM Provisioning (0:30 – 1:15)

#### On-screen visual:
- **0:30 - 0:42:** AstroAm main screen (`localhost:5173` or mobile app). The user selects the destination: **Brazil 🇧🇷** (rate: `0.0025 USDC / MB`). They set a budget of **5.00 USDC** and press **"START MISSION"**.
- **0:42 - 0:58:** Deposit screen. The **"DEPOSIT & CONNECT"** button is shown. The **MetaMask Connect** modal is displayed.
  1. The user authorizes the connection to Monad Testnet (Chain ID `10143`).
  2. Signature 1: `approve` of Circle USDC (5.00 USDC).
  3. Signature 2: `deposit` into the immutable `AstroAmEscrow` v3 contract.
- **0:58 - 1:07:** Zoom into the browser / console: it is graphically highlighted that, before depositing, the application generated in the browser an ephemeral **Session Key** (`generatePrivateKey()`) stored in `localStorage`, registering its public signer directly in the on-chain escrow.
- **1:07 - 1:15:** The deposit transaction is confirmed in 1 second on Monad. The connectivity API (**Citrus Mobile**) immediately provisions the eSIM. The QR code ready to scan and the direct LPA installation link appear on screen.

#### Voice-over:
> **[ES]**  
> *"Let's see it in action. We select our destination, for example Brazil, at 0.0025 USDC per megabyte, and assign a deposit of 5 dollars with Circle USDC.*  
> *We connect our wallet through MetaMask Connect on Monad Testnet. We confirm the USDC approval and the deposit into our AstroAmEscrow contract.*  
> *Here the first innovation happens: at the moment of the deposit, the dApp locally generates a cryptographic session key on the device and registers its address in the contract.*  
> *And that's it! In under a second thanks to Monad's high performance, the contract holds the 5 USDC and the Citrus Mobile API delivers our eSIM ready to use."*

> **[EN Subtitles]**  
> *"Let's see it live. We select Brazil at 0.0025 USDC per megabyte and set a 5 USDC deposit.*  
> *Connecting via MetaMask Connect on Monad Testnet, we confirm the USDC approval and escrow deposit.*  
> *Here is the first breakthrough: on deposit, the app locally generates a cryptographic session key and registers its signer on-chain.*  
> *In under a second thanks to Monad's speed, the escrow secures the 5 USDC and Citrus Mobile provisions our instant eSIM QR code."*

---

### Act 3: Flight Cockpit: Data Usage and Silent EIP-712 Vouchers (1:15 – 2:00)

#### On-screen visual:
- **1:15 - 1:30:** Transition to the **Mission Cockpit ("Flight Cockpit")**. Futuristic interface with real-time telemetry: data usage speedometer, available balance in USDC and live traffic chart.
- **1:30 - 1:45:** The simulation of real data traffic consuming **250 MB** is activated.
- **1:45 - 2:00:** Split-screen demonstration:
  - Left side: The MB meter rises smoothly from 0 to 250 MB and the balance in the UI goes from 5.00 USDC to 4.375 USDC available.
  - Right side: The MetaMask window stays completely calm and at rest. **Zero popups! Zero signature requests!**
  - Overlaid animated graphic: Shows how each micro-block generates an EIP-712 voucher signed locally by the Session Key off the chain (*off-chain*), sent via API to the operator.

#### Voice-over:
> **[ES]**  
> *"We land at our destination and enter the AstroAm flight cockpit. The user starts browsing, sending messages and using maps.*  
> *We simulate a real consumption of 250 megabytes. Watch the screen closely: the data flows, the telemetry updates in real time, but MetaMask never interrupts.*  
> *There are no annoying popups and no gas burned for each megabyte. Thanks to the EIP-712 vouchers signed silently by the local session key, we achieve the fluidity of a Web2 application with the sovereign, decentralized security of Web3."*

> **[EN Subtitles]**  
> *"We land at our destination and open the AstroAm cockpit. The traveler browses, messages, and navigates.*  
> *We stream 250 megabytes of real data. Notice MetaMask: completely undisturbed. Zero popups, zero friction!*  
> *Through off-chain EIP-712 vouchers signed silently by the local session key, we deliver Web2-level seamlessness with true Web3 cryptographic guarantees."*

---

### Act 4: Ending the Trip ("END MISSION"), MonadVision and Atomic Refund (2:00 – 2:45)

#### On-screen visual:
- **2:00 - 2:10:** The user ends their trip and presses the red **"END MISSION"** button in the cockpit.
- **2:10 - 2:20:** The screen shows the state *"Settling on Monad Testnet..."*. The AstroAm backend takes the last signed voucher (for 250 MB = 0.625 USDC) and calls the `close()` function on the contract.
- **2:20 - 2:35:** The official **MonadVision** explorer (`testnet.monadvision.com/tx/...`) opens full screen:
  - Status: **Success**.
  - *Token Transfers (ERC-20)* tab with a highlighted zoom:
    - **Transfer 1:** `0.625 USDC` from Escrow to the AstroAm Payee (`0xE3E38...`).
    - **Transfer 2:** `4.375 USDC` from Escrow **directly back to the traveler's wallet (`0x4aB3...`)**.
- **2:35 - 2:45:** The MetaMask extension is opened on the **Tokens → USDC** tab: the traveler's balance immediately reflects the receipt of the 4.375 USDC. In the dApp, the **"Mission Settled"** modal shows: *"Paid: 0.625 USDC / Back to your wallet: 4.375 USDC"*.

#### Voice-over:
> **[ES]**  
> *"Our trip is over. We press 'END MISSION'.*  
> *The operator takes the last cumulative voucher of 250 megabytes and executes the close transaction on-chain.*  
> *Let's go straight to the MonadVision explorer. Look at the magic of smart contracts: in a single atomic transaction, the contract transfers 0.625 USDC to the operator for the service consumed, and automatically returns 4.375 USDC of surplus to the traveler's wallet.*  
> *We open MetaMask: the refund of 4.375 USDC is already credited under USDC Tokens. No support tickets, no waiting 30 days, without losing a single cent."*

> **[EN Subtitles]**  
> *"The trip is complete. We hit 'END MISSION'.*  
> *The operator submits the final 250 MB voucher and executes the on-chain close call.*  
> *In MonadVision Explorer, witness smart contract atomicity: in one single transaction, 0.625 USDC goes to the operator, and 4.375 USDC is automatically refunded to the traveler's wallet.*  
> *In MetaMask, the 4.375 USDC is already in our balance. No support tickets, no 30-day waiting period, zero wasted dollars."*

---

### Act 5: Technology Stack, Architecture and Close (2:45 – 3:00)

#### On-screen visual:
- **2:45 - 2:55:** Visual card with the architecture and the technology pillars of the project:
  - **Monad EVM:** High throughput (10,000 TPS), 1-second finality and minimal gas fees.
  - **Circle USDC:** Global, stable and transparent settlement currency.
  - **Citrus Mobile:** Telco-grade telecommunications infrastructure with coverage in more than 150 countries.
  - **EIP-712 Session Keys:** Client-side cryptography for frictionless micropayments.
- **2:55 - 3:00:** Final closing screen with the AstroAm logo, links to the GitHub repository and MonadVision, and a call to the Monad Metropolis jury.

#### Voice-over:
> **[ES]**  
> *"AstroAm unites the power of Monad's 10,000 transactions per second with Citrus's global telecommunications network and the solidity of Circle USDC.*  
> *Mobile roaming finally has the economic model and the user experience it deserved.*  
> *Thank you to the Monad team and welcome to the future of decentralized connectivity with AstroAm."*

> **[EN Subtitles]**  
> *"AstroAm pairs Monad's 10,000 TPS performance with Citrus Mobile's telco infrastructure and Circle USDC stability.*  
> *Mobile roaming finally has the fair business model and friction-free UX it always deserved.*  
> *Thank you Monad team, and welcome to the decentralized future of connectivity with AstroAm."*

---

## 4. Pre-Recording Production Checklist

- [ ] Clean browser with bookmarks to:
  - AstroAm dApp (`http://localhost:5173`)
  - MonadVision explorer (`https://testnet.monadvision.com`)
  - Circle / Monad faucet
- [ ] MetaMask configured with:
  - Monad Testnet network (Chain ID 10143)
  - MON balance for gas (~2+ MON)
  - Circle USDC balance (~10+ USDC)
  - USDC token added in the Tokens tab (`0x534b2f3A21130d7a60830c2Df862319e593943A3`)
- [ ] Backend running with contract v3 (`0xe89893d51180e517e2bf175398aad2e6da82c0f9`) and the payee configured in `.env`.
- [ ] Recording resolution set to 1920x1080 with clean microphone audio and no echo.

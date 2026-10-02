# AstroAm en Monad testnet

Datos móviles prepago: el viajero deposita USDC de prueba, el consumo se mide off-chain y un solo cierre paga a AstroAm lo usado y devuelve el resto.

La app (React/Vite) y la API de misiones (Node) vienen de la build de Stellar
([FrancoDuran23/stellar_jujuy_dev@a19ed4d](https://github.com/FrancoDuran23/stellar_jujuy_dev/tree/a19ed4d)).
Ese canal de Soroban sigue en el repo como historia del código. **No es el camino de pago de esta demo.** El pago es el escrow de este repositorio, en Monad testnet.

## Qué hace la demo

1. El viajero arma la misión (destino, días, presupuesto) y conecta **MetaMask o Rabby**.
2. La app llama `wallet_addEthereumChain` para Monad testnet (chain id **10143**, RPC `https://testnet-rpc.monad.xyz`).
3. Deposita Circle test USDC en `AstroAmEscrow`. Una transferencia. No hay un débito por cada MB.
4. La eSIM y el botón **TRÁFICO** siguen el camino de demo (`FakeProvider`). No se llama a la API real de Citrus.
5. Cada lectura acumula el costo off-chain. Al finalizar, la wallet firma un vale EIP-712 por el acumulado y manda **una** transacción `close`: AstroAm cobra lo usado y el contrato devuelve el resto en esa misma transacción.
6. Si AstroAm nunca cierra, pasado el timeout el viajero llama `refund` y recupera el depósito entero.
7. Cada transacción se enlaza en [MonadVision](https://testnet.monadvision.com).

Phantom no se usa.

## USDC

Dirección publicada por Circle para Monad testnet, y confirmada en el RPC:

| Campo | Valor |
|---|---|
| Token | USDC |
| Dirección | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Decimales | **6** (`decimals()` devolvió `6`) |
| Chain id | `10143` (`0x279f`) |

Fuente: [USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses). El USDC de la build Stellar es de **7** decimales (1 raw = 1e-7). Usar esa cifra contra este token cobra diez veces de más; el contrato rechaza un token que no declara 6 decimales, y el cierre cotiza el acumulado en unidades de 6.

Faucet de USDC: [faucet.circle.com](https://faucet.circle.com) (token USDC, red Monad Testnet). Gas en MON: [faucet.monad.xyz](https://faucet.monad.xyz).

## Correr la app

Node ≥ 22.18.

```bash
cp .env.example .env
npm install
npm run server                      # API en http://localhost:8080

cd frontend && npm install && npm run dev   # app en http://localhost:5173
```

No crees `frontend/.env`. Sin `VITE_API_BASE_URL`, Vite reenvía `/api` al backend. Dejá `ASTROAM_LIVE_ENABLED=false` y `CONNECTIVITY_PROVIDER=fake`. En la misión activa, **TRÁFICO** suma 250 MB por toque y no sale a la red.

El modo `VITE_ASTROAM_MODE=demo` sigue siendo la demo sin wallet (eSIM y tráfico locales). El depósito y el cierre de Monad están en el modo API, que es el default.

## Desplegar el escrow

Este entorno no desplegó el contrato: no hay clave ni fondos de faucet. **No hay una dirección de escrow para copiar.** Un humano la obtiene así:

1. Instalar Foundry: `curl -L https://foundry.paradigm.xyz | bash` y después `foundryup`.
2. Pedir MON de prueba en https://faucet.monad.xyz para la cuenta que despliega.
3. Exportar la clave y la cuenta que cobra lo usado (puede ser la misma):

```bash
export MONAD_DEPLOYER_PRIVATE_KEY=0x...
export MONAD_PAYEE_ADDRESS=0x...
# opcional; el default del script es 604800 (7 días)
export MONAD_TIMEOUT_SECONDS=604800
```

4. Desde la raíz del repo:

```bash
npm run monad:deploy
```

El script compila con `forge build` si hace falta y publica con viem contra `https://testnet-rpc.monad.xyz`. Imprime `MONAD_ESCROW_ADDRESS=` **solo** con la dirección del receipt.

5. Pegar esa línea, y `MONAD_PAYEE_ADDRESS`, en `.env`. Reiniciar `npm run server`.

Si falta la clave, `npm run monad:deploy` sale con estas mismas instrucciones y no inventa una dirección.

Contrato: `contracts/src/AstroAmEscrow.sol`.

| Función | Quién | Qué hace |
|---|---|---|
| `deposit(escrowId, amount)` | viajero | Trae USDC (6 decimales) a la custodia. |
| `topUp(escrowId, amount)` | viajero | Suma USDC antes del cierre. |
| `close(escrowId, cumulativeAmount, signature)` | cualquiera con el vale | El vale EIP-712 lo firma el viajero por el acumulado. Paga `payee` y reembolsa el resto en la misma transacción. Una sola vez. |
| `refund(escrowId)` | cualquiera, después del timeout | Devuelve el depósito entero al viajero si nadie cerró. |

## Cheques

```bash
npm test                 # API, cotización a 6 decimales, y el escrow en anvil si forge/anvil están instalados
npm run check            # tsc
npm run contracts:test   # forge: depósito, cierre con reembolso, reembolso por timeout
cd frontend && npx tsc --noEmit
```

## Qué no incluye

Mainnet, una eSIM real, ni un build de tienda. El proveedor de conectividad de la demo es `FakeProvider`.

// Monad testnet rail. Circle publishes this USDC address for Monad Testnet
// (https://developers.circle.com/stablecoins/usdc-contract-addresses). An
// eth_call of decimals() against https://testnet-rpc.monad.xyz returned 6,
// and symbol() returned USDC. Chain id 0x279f is 10143.
// Stellar USDC in the original app is 7 decimals (1 raw = 1e-7). Do not reuse
// those raw amounts as the atomic unit of this token.

export const MONAD_CHAIN_ID = 10143 as const;
export const MONAD_CHAIN_ID_HEX = "0x279f" as const;
export const MONAD_CHAIN_NAME = "Monad Testnet" as const;
export const MONAD_RPC_URL = "https://testnet-rpc.monad.xyz" as const;
export const MONAD_EXPLORER = "https://testnet.monadvision.com" as const;
export const MONAD_USDC_ADDRESS = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const;
export const MONAD_USDC_DECIMALS = 6 as const;
export const STELLAR_USDC_DECIMALS = 7 as const;
export const DEFAULT_ESCROW_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;

export const VOUCHER_DOMAIN_NAME = "AstroAmEscrow" as const;
export const VOUCHER_DOMAIN_VERSION = "1" as const;

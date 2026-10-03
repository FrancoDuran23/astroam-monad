// Monad testnet. Circle publishes this USDC address for Monad Testnet
// (https://developers.circle.com/stablecoins/usdc-contract-addresses); an
// eth_call of decimals() against the public RPC returns 6. Chain id 10143.

export const MONAD_CHAIN_ID = 10143 as const;
export const MONAD_CHAIN_ID_HEX = "0x279f" as const;
export const MONAD_CHAIN_NAME = "Monad Testnet" as const;
export const MONAD_NETWORK = "monad:testnet" as const;
export const MONAD_RPC_URL = "https://testnet-rpc.monad.xyz" as const;
export const MONAD_EXPLORER = "https://testnet.monadvision.com" as const;
export const MONAD_USDC_ADDRESS = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const;
export const MONAD_USDC_DECIMALS = 6 as const;
/** Default escrow timeout: long enough that a normal trip never hits it. */
export const DEFAULT_ESCROW_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;

export const VOUCHER_DOMAIN_NAME = "AstroAmEscrow" as const;
export const VOUCHER_DOMAIN_VERSION = "1" as const;

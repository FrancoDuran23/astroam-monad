import { MONAD_EXPLORER } from "./constants.ts";

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function monadTxUrl(txHash: string, explorer: string = MONAD_EXPLORER): string | undefined {
  return TX_RE.test(txHash) ? `${explorer}/tx/${txHash}` : undefined;
}

export function monadAddressUrl(address: string, explorer: string = MONAD_EXPLORER): string | undefined {
  return ADDRESS_RE.test(address) ? `${explorer}/address/${address}` : undefined;
}

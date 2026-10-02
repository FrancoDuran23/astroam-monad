import { MONAD_EXPLORER } from "./constants.ts";

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function monadTxUrl(txHash: string): string | null {
  if (!TX_RE.test(txHash)) return null;
  return `${MONAD_EXPLORER}/tx/${txHash}`;
}

export function monadAddressUrl(address: string): string | null {
  if (!ADDRESS_RE.test(address)) return null;
  return `${MONAD_EXPLORER}/address/${address}`;
}

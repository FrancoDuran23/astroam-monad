// The app accounts in raw units of 1e-7 USDC; Circle USDC on Monad has 6
// decimals. 1 atomic unit = 10 raw units. Money stays BigInt.

const RAW_PER_ATOMIC = 10n;

/** Raw (1e-7) to USDC atomic (1e-6), rounding UP: a voucher must cover the reading. */
export function rawToAtomicCeil(raw: bigint): bigint {
  if (raw < 0n) throw new RangeError("rawToAtomicCeil: negative amount");
  return (raw + RAW_PER_ATOMIC - 1n) / RAW_PER_ATOMIC;
}

/** Raw (1e-7) to USDC atomic (1e-6), rounding DOWN: never settle more than used. */
export function rawToAtomicFloor(raw: bigint): bigint {
  if (raw < 0n) throw new RangeError("rawToAtomicFloor: negative amount");
  return raw / RAW_PER_ATOMIC;
}

/** USDC atomic (1e-6) to raw (1e-7), exact. */
export function atomicToRaw(atomic: bigint): bigint {
  if (atomic < 0n) throw new RangeError("atomicToRaw: negative amount");
  return atomic * RAW_PER_ATOMIC;
}

/** Human USDC amount (as shown in the app) to atomic units, exact to 6 decimals. */
export function usdcToAtomic(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) throw new RangeError(`usdcToAtomic: invalid amount ${usdc}`);
  const [whole, frac = ""] = usdc.toFixed(6).split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
}

export function formatAtomic(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const frac = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

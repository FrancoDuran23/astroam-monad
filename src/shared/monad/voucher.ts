// EIP-712 vouchers for AstroAmEscrow: `Voucher(bytes32 escrowId,uint256
// cumulativeAmount)`, signed by the traveler's session key (or the traveler).
// The server verifies them off-chain; the contract verifies the one used to close.

import { keccak256, recoverTypedDataAddress, toBytes, type Address, type Hex } from "viem";
import { VOUCHER_DOMAIN_NAME, VOUCHER_DOMAIN_VERSION } from "./constants.ts";

export const VOUCHER_TYPES = {
  Voucher: [
    { name: "escrowId", type: "bytes32" },
    { name: "cumulativeAmount", type: "uint256" },
  ],
} as const;

export function voucherDomain(chainId: number, escrow: Address) {
  return { name: VOUCHER_DOMAIN_NAME, version: VOUCHER_DOMAIN_VERSION, chainId, verifyingContract: escrow } as const;
}

/** The escrow id a mission deposits into. One mission, one channel. */
export function escrowIdForMission(missionId: string): Hex {
  return keccak256(toBytes(`astroam-escrow:${missionId}`));
}

export async function recoverVoucherSigner(input: {
  chainId: number;
  escrow: Address;
  escrowId: Hex;
  cumulativeAmount: bigint;
  signature: Hex;
}): Promise<Address> {
  return recoverTypedDataAddress({
    domain: voucherDomain(input.chainId, input.escrow),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: { escrowId: input.escrowId, cumulativeAmount: input.cumulativeAmount },
    signature: input.signature,
  });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MONAD_CHAIN_ID } from "./constants.ts";
import { escrowIdForMission, recoverVoucherSigner, voucherDomain, VOUCHER_TYPES } from "./voucher.ts";

// The values AstroAmEscrow.voucherHash returned in Foundry for this chain id,
// contract address, escrow id and amount. contracts/test/AstroAmEscrow.t.sol
// (test_voucherHashMatchesTheDigestPinnedInTypeScript) pins the same digest,
// so a change on either side of the EIP-712 encoding fails one of the two.
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const ESCROW_ID = "0xfa2f7530ba38155af9b4b4d2eef061d95d4552ed9b552bce09600e3c97be93a2";
const AMOUNT = 1_875_000n;
const CONTRACT_DIGEST = "0x8c20e045a32f9dea7ca92ddbc40f321563bbe7d58b8da80a1017d01dfcd08904";

test("the escrow id of a mission is the one the contract tests deposit into", () => {
  assert.equal(escrowIdForMission("mis_demo"), ESCROW_ID);
});

test("the voucher typed-data hash equals the digest the contract computes in voucherHash", () => {
  const digest = hashTypedData({
    domain: voucherDomain(MONAD_CHAIN_ID, ESCROW),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: { escrowId: escrowIdForMission("mis_demo"), cumulativeAmount: AMOUNT },
  });
  assert.equal(digest, CONTRACT_DIGEST);
});

test("the voucher hash changes with the chain, the contract, the escrow and the amount", () => {
  const hash = (chainId: number, escrow: `0x${string}`, missionId: string, cumulativeAmount: bigint) =>
    hashTypedData({
      domain: voucherDomain(chainId, escrow),
      types: VOUCHER_TYPES,
      primaryType: "Voucher",
      message: { escrowId: escrowIdForMission(missionId), cumulativeAmount },
    });
  const other = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  assert.notEqual(hash(MONAD_CHAIN_ID + 1, ESCROW, "mis_demo", AMOUNT), CONTRACT_DIGEST);
  assert.notEqual(hash(MONAD_CHAIN_ID, other, "mis_demo", AMOUNT), CONTRACT_DIGEST);
  assert.notEqual(hash(MONAD_CHAIN_ID, ESCROW, "mis_other", AMOUNT), CONTRACT_DIGEST);
  assert.notEqual(hash(MONAD_CHAIN_ID, ESCROW, "mis_demo", AMOUNT + 1n), CONTRACT_DIGEST);
});

test("recoverVoucherSigner returns the key that signed the voucher", async () => {
  // First anvil test key: public, never holds real funds.
  const session = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const signature = await session.signTypedData({
    domain: voucherDomain(MONAD_CHAIN_ID, ESCROW),
    types: VOUCHER_TYPES,
    primaryType: "Voucher",
    message: { escrowId: ESCROW_ID, cumulativeAmount: AMOUNT },
  });
  const input = { chainId: MONAD_CHAIN_ID, escrow: ESCROW, escrowId: ESCROW_ID, signature } as const;
  assert.equal(await recoverVoucherSigner({ ...input, cumulativeAmount: AMOUNT }), session.address);
  // The same signature over another amount recovers some other address.
  assert.notEqual(await recoverVoucherSigner({ ...input, cumulativeAmount: AMOUNT + 1n }), session.address);
});

// Close one AstroAmEscrow (v4) with no usage beyond what was already claimed:
// the operator calls close(id, claimed, "0x", claimed) and the rest of the
// deposit goes back to the traveler in the same transaction (the whole deposit
// if nothing was claimed). Used to recover a deposit whose mission never
// activated. The key only sends the transaction: it receives nothing.
//
//   npm run monad:close-escrow -- 0x<escrowId>           # reads state only
//   npm run monad:close-escrow -- 0x<escrowId> --send    # sends the tx
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { astroAmEscrowAbi } from "../src/shared/monad/abi.ts";
import {
  MONAD_CHAIN_ID,
  MONAD_CHAIN_NAME,
  MONAD_EXPLORER,
  MONAD_RPC_URL,
  MONAD_USDC_DECIMALS,
} from "../src/shared/monad/constants.ts";

const escrowId = process.argv[2] as Hex | undefined;
const send = process.argv.includes("--send");
if (!escrowId || !/^0x[0-9a-fA-F]{64}$/.test(escrowId)) {
  console.error("Usage: npm run monad:close-escrow -- 0x<64-hex escrowId> [--send]");
  process.exit(1);
}

const contract = process.env.MONAD_ESCROW_ADDRESS?.trim();
if (!contract || !isAddress(contract)) {
  console.error("MONAD_ESCROW_ADDRESS is missing or not an address.");
  process.exit(1);
}
const key = process.env.MONAD_OPERATOR_PRIVATE_KEY?.trim();
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("MONAD_OPERATOR_PRIVATE_KEY is missing or malformed (the escrow's operator, or its payee, is who can close).");
  process.exit(1);
}

const chain = defineChain({
  id: MONAD_CHAIN_ID,
  name: MONAD_CHAIN_NAME,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } },
});
const account = privateKeyToAccount(key as Hex);
const publicClient = createPublicClient({ chain, transport: http(MONAD_RPC_URL) });

const [traveler, , settled, , deposit, claimed] = await publicClient.readContract({
  address: contract,
  abi: astroAmEscrowAbi,
  functionName: "escrows",
  args: [escrowId],
});
const readAddress = (functionName: "operator" | "payee") =>
  publicClient.readContract({ address: contract, abi: astroAmEscrowAbi, functionName }) as Promise<Address>;
const [operator, payee] = await Promise.all([readAddress("operator"), readAddress("payee")]);

const usdc = (raw: bigint) => `${formatUnits(raw, MONAD_USDC_DECIMALS)} USDC`;
console.log(`Escrow:   ${escrowId}`);
console.log(`Traveler: ${traveler}`);
console.log(`Deposit:  ${usdc(deposit)}`);
console.log(`Claimed:  ${usdc(claimed)}`);
console.log(`Settled:  ${settled}`);
console.log(`Operator: ${operator}`);
console.log(`Payee:    ${payee}`);

if (/^0x0{40}$/.test(traveler)) {
  console.error("This escrow does not exist on this contract.");
  process.exit(1);
}
if (settled) {
  console.error("Already settled: nothing to do.");
  process.exit(1);
}
if (account.address !== getAddress(operator) && account.address !== getAddress(payee)) {
  console.error(`${account.address} is neither the operator nor the payee of this contract: close would revert with NotOperator.`);
  process.exit(1);
}
if (!send) {
  console.log(`\nDry run. With --send, ${account.address} closes it and ${usdc(deposit - claimed)} returns to ${traveler}.`);
  process.exit(0);
}

const wallet = createWalletClient({ account, chain, transport: http(MONAD_RPC_URL) });
const hash = await wallet.writeContract({
  address: contract,
  abi: astroAmEscrowAbi,
  functionName: "close",
  args: [escrowId, claimed, "0x", claimed],
});
console.log(`Close tx: ${MONAD_EXPLORER}/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") {
  console.error("close reverted.");
  process.exit(1);
}
console.log(`Done: ${usdc(deposit - claimed)} refunded to ${traveler}.`);

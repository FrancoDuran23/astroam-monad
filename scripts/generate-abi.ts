// Rewrite `astroAmEscrowAbi` in src/shared/monad/abi.ts from the Foundry
// artifact. Run it after `forge build --root contracts` whenever
// contracts/src/AstroAmEscrow.sol changes. Everything else in abi.ts (the
// header, the hand-written ERC-20 fragment) is left as it is.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ARTIFACT = join(ROOT, "contracts", "out", "AstroAmEscrow.sol", "AstroAmEscrow.json");
const TARGET = join(ROOT, "src", "shared", "monad", "abi.ts");
const START = "export const astroAmEscrowAbi = ";
const END = "\n] as const;\n";

if (!existsSync(ARTIFACT)) {
  console.error(`No artifact at ${ARTIFACT}. Run: forge build --root contracts`);
  process.exit(1);
}
const compiled = JSON.parse(await readFile(ARTIFACT, "utf8")) as { abi?: unknown[] };
if (!Array.isArray(compiled.abi) || compiled.abi.length === 0) {
  console.error(`Artifact ${ARTIFACT} has no ABI. Rebuild it: forge build --root contracts`);
  process.exit(1);
}

const current = await readFile(TARGET, "utf8");
const start = current.indexOf(START);
const end = start === -1 ? -1 : current.indexOf(END, start);
if (start === -1 || end === -1) {
  console.error(`${TARGET} has no \`${START}[ ... ] as const;\` block to replace.`);
  process.exit(1);
}

const block = `${START}${JSON.stringify(compiled.abi, null, 2)} as const;\n`;
const next = current.slice(0, start) + block + current.slice(end + END.length);
if (next === current) {
  console.log(`${TARGET} is already up to date.`);
} else {
  await writeFile(TARGET, next);
  console.log(`Rewrote astroAmEscrowAbi in ${TARGET} (${compiled.abi.length} entries).`);
}

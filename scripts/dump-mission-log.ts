// Print one trip's mission log as the evidence text kept under docs/evidence/
// (spec 13): a readable line per event, then the raw JSON lines, with the
// ICCID's middle digits hidden. Read-only: it only reads
// DATA_DIR/mission-log.jsonl.
//
//   npm run log:dump -- <missionId>                     # prints it
//   npm run log:dump -- <missionId> --out <file.txt>    # writes it
import "dotenv/config";
import fs from "node:fs";
import { FileMissionLog } from "../src/product/persistence/MissionLog.ts";
import { formatMissionLogEvidence } from "../src/product/persistence/MissionLogEvidence.ts";

const missionId = process.argv[2];
const outIndex = process.argv.indexOf("--out");
const out = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
if (!missionId || missionId.startsWith("--") || (outIndex > 0 && !out)) {
  console.error("Usage: npm run log:dump -- <missionId> [--out <file.txt>]");
  process.exit(1);
}

const log = new FileMissionLog(process.env.DATA_DIR);
const entries = await log.list(missionId);
if (entries.length === 0) {
  console.error(`No entries for ${missionId} in ${log.filePath}.`);
  process.exit(1);
}

const text = formatMissionLogEvidence(missionId, entries);
if (out) {
  fs.writeFileSync(out, text, "utf-8");
  console.log(`${entries.length} entries written to ${out}.`);
} else {
  process.stdout.write(text);
}

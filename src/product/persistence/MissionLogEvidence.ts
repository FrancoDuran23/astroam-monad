import type { MissionLogEntry } from './MissionLog.ts'

/** An ICCID with its middle digits hidden: the issuer prefix and the last four stay. */
export function maskIccid(iccid: string): string {
  if (iccid.length <= 10) return '*'.repeat(iccid.length)
  return `${iccid.slice(0, 6)}${'*'.repeat(iccid.length - 10)}${iccid.slice(-4)}`
}

function masked(entry: MissionLogEntry): MissionLogEntry {
  return { ...entry, iccid: entry.iccid === null ? null : maskIccid(entry.iccid) }
}

/**
 * One trip's log as the evidence text kept under `docs/evidence/`: a header,
 * a readable line per event, then the raw JSON lines as the API wrote them.
 * The ICCID is masked in both parts; nothing else is changed.
 */
export function formatMissionLogEvidence(missionId: string, entries: MissionLogEntry[], notes: string[] = []): string {
  const width = Math.max(0, ...entries.map((entry) => entry.type.length))
  const events = entries.map((entry) => {
    const fields = Object.entries(entry.data).map(([key, value]) => `${key}=${value}`)
    return [entry.at, entry.type.padEnd(width), ...fields].join('  ').trimEnd()
  })
  return [
    `AstroAm mission log: ${missionId}`,
    ...notes,
    'Source: DATA_DIR/mission-log.jsonl, written by the API (src/product/persistence/MissionLog.ts). ICCID middle digits hidden.',
    '',
    'EVENTS (UTC)',
    ...(events.length > 0 ? events : ['(no entries)']),
    '',
    'RAW JSONL (one line per event, as the API wrote it, ICCID masked)',
    ...entries.map((entry) => JSON.stringify(masked(entry))),
    '',
  ].join('\n')
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMissionLogEvidence, maskIccid } from './MissionLogEvidence.ts'
import type { MissionLogEntry } from './MissionLog.ts'

const ICCID = '8910300000012348224'

function entry(at: string, type: MissionLogEntry['type'], data: MissionLogEntry['data']): MissionLogEntry {
  return { v: 1, at, missionId: 'mis_1', iccid: ICCID, type, data }
}

test('an ICCID keeps its prefix and last four digits', () => {
  assert.equal(maskIccid(ICCID), '891030*********8224')
  assert.equal(maskIccid('12345'), '*****')
})

test('the evidence lists every entry in order, readable and raw, with the ICCID hidden', () => {
  const entries = [
    entry('2026-10-09T21:00:20.000Z', 'escrow.deposit', { txHash: '0xabc', depositAtomic: '2000000' }),
    entry('2026-10-09T21:21:08.000Z', 'usage.reading', { meteredBytes: '109615384', consumedMb: 109.62 }),
  ]

  const text = formatMissionLogEvidence('mis_1', entries, ['Destination Argentina'])
  const lines = text.split('\n')

  assert.equal(lines[0], 'AstroAm mission log: mis_1')
  assert.equal(lines[1], 'Destination Argentina')
  assert.ok(lines.includes('2026-10-09T21:00:20.000Z  escrow.deposit  txHash=0xabc  depositAtomic=2000000'))
  assert.ok(lines.includes('2026-10-09T21:21:08.000Z  usage.reading   meteredBytes=109615384  consumedMb=109.62'))
  const raw = lines.filter((line) => line.startsWith('{'))
  assert.deepEqual(raw.map((line) => JSON.parse(line).type), ['escrow.deposit', 'usage.reading'])
  assert.equal(JSON.parse(raw[0]!).iccid, '891030*********8224')
  assert.equal(text.includes(ICCID), false)
})

test('a trip with no entries says so', () => {
  assert.ok(formatMissionLogEvidence('mis_1', []).includes('(no entries)'))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileMissionLog, MemoryMissionLog, type MissionLogEntry } from './MissionLog.ts'

function entry(missionId: string, type: MissionLogEntry['type'], data: MissionLogEntry['data'] = {}): MissionLogEntry {
  return { v: 1, at: '2026-10-09T12:00:00.000Z', missionId, iccid: '8988000000000000001', type, data }
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mission-log-'))

test('the file log keeps every entry in order and lists one trip at a time', async () => {
  const log = new FileMissionLog(tempDir())
  log.append(entry('m_a', 'esim.provisioned', { isMock: true }))
  log.append(entry('m_b', 'esim.provisioned', { isMock: true }))
  log.append(entry('m_a', 'usage.reading', { meteredBytes: '240000000' }))

  const entries = await log.list('m_a')
  assert.deepEqual(entries.map((e) => e.type), ['esim.provisioned', 'usage.reading'])
  assert.equal(entries[1]!.data.meteredBytes, '240000000')
  assert.equal(fs.readFileSync(log.filePath, 'utf-8').trim().split('\n').length, 3)
})

test('a new instance on the same directory reads what an earlier one wrote and appends after it', async () => {
  const dir = tempDir()
  new FileMissionLog(dir).append(entry('m_a', 'esim.provisioned'))

  const later = new FileMissionLog(dir)
  later.append(entry('m_a', 'escrow.claim', { txHash: '0xabc' }))

  assert.deepEqual((await new FileMissionLog(dir).list('m_a')).map((e) => e.type), ['esim.provisioned', 'escrow.claim'])
})

test('a line cut short by a crash is skipped, not fatal', async () => {
  const log = new FileMissionLog(tempDir())
  log.append(entry('m_a', 'esim.provisioned'))
  fs.appendFileSync(log.filePath, '{"v":1,"missionId":"m_a","ty')
  fs.appendFileSync(log.filePath, '\n')
  log.append(entry('m_a', 'esim.paused', { reason: 'traveler' }))

  assert.deepEqual((await log.list('m_a')).map((e) => e.type), ['esim.provisioned', 'esim.paused'])

  // The last line cut short, with no newline after it.
  fs.appendFileSync(log.filePath, '{"v":1,"missionId":"m_a","type":"esim.resu')
  assert.deepEqual((await log.list('m_a')).map((e) => e.type), ['esim.provisioned', 'esim.paused'])
})

test('a log that was never written lists nothing', async () => {
  assert.deepEqual(await new FileMissionLog(tempDir()).list('m_a'), [])
})

test('the memory log lists one trip at a time and hands out copies', async () => {
  const log = new MemoryMissionLog()
  log.append(entry('m_a', 'esim.provisioned', { isMock: true }))
  log.append(entry('m_b', 'esim.provisioned'))

  const listed = await log.list('m_a')
  assert.equal(listed.length, 1)
  listed[0]!.data.isMock = false
  assert.equal((await log.list('m_a'))[0]!.data.isMock, true)
})

import { describe, expect, it } from 'vitest'
import { isEasyAnalyseProjectPath, LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH } from './easyAnalyseProject'

describe('easyAnalyseProject', () => {
  it('recognizes project directory paths across platforms', () => {
    expect(isEasyAnalyseProjectPath('/tmp/filter.easyanalyse')).toBe(true)
    expect(isEasyAnalyseProjectPath('/tmp/filter.easyanalyse/')).toBe(true)
    expect(isEasyAnalyseProjectPath('C:\\work\\filter.easyanalyse')).toBe(true)
    expect(isEasyAnalyseProjectPath('/tmp/filter.easyanalyse.json')).toBe(false)
    expect(isEasyAnalyseProjectPath('/tmp/filter.json')).toBe(false)
    expect(isEasyAnalyseProjectPath(null)).toBe(false)
  })

  it('keeps the live draft partial path stable', () => {
    expect(LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH).toBe('working-copy/live-draft.raw.json.partial')
  })
})


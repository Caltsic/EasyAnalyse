import { describe, expect, it } from 'vitest'
import {
  createEasyAnalyseProjectManifest,
  EASYANALYSE_PROJECT_BLUEPRINT_WORKSPACE_RELATIVE_PATH,
  EASYANALYSE_PROJECT_DOCUMENT_RELATIVE_PATH,
  EASYANALYSE_PROJECT_FORMAT_VERSION,
  EASYANALYSE_PROJECT_MANIFEST_RELATIVE_PATH,
  isEasyAnalyseProjectPath,
  LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH,
  normalizeEasyAnalyseProjectManifest,
} from './easyAnalyseProject'

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

  it('keeps project manifest paths stable', () => {
    expect(EASYANALYSE_PROJECT_MANIFEST_RELATIVE_PATH).toBe('project.easyanalyse-project.json')
    expect(EASYANALYSE_PROJECT_DOCUMENT_RELATIVE_PATH).toBe('working-copy/document.json')
    expect(EASYANALYSE_PROJECT_BLUEPRINT_WORKSPACE_RELATIVE_PATH).toBe('blueprints/workspace.easyanalyse-blueprints.json')
  })

  it('creates a minimal project manifest with optional live draft metadata', () => {
    const manifest = createEasyAnalyseProjectManifest({
      now: '2026-06-05T00:00:00.000Z',
      liveDraftUpdatedAt: '2026-06-05T00:01:00.000Z',
    })

    expect(manifest).toEqual({
      projectFormatVersion: EASYANALYSE_PROJECT_FORMAT_VERSION,
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
      workingCopy: {
        documentPath: EASYANALYSE_PROJECT_DOCUMENT_RELATIVE_PATH,
      },
      blueprintWorkspace: {
        path: EASYANALYSE_PROJECT_BLUEPRINT_WORKSPACE_RELATIVE_PATH,
      },
      liveDraft: {
        status: 'active',
        version: 1,
        partialPath: LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH,
        updatedAt: '2026-06-05T00:01:00.000Z',
      },
    })
  })

  it('normalizes corrupt or older project manifests into the current contract', () => {
    expect(normalizeEasyAnalyseProjectManifest(null, { now: '2026-06-05T00:00:00.000Z' })).toEqual(
      createEasyAnalyseProjectManifest({ now: '2026-06-05T00:00:00.000Z' }),
    )
    expect(normalizeEasyAnalyseProjectManifest({
      projectFormatVersion: EASYANALYSE_PROJECT_FORMAT_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '',
      workingCopy: { documentPath: 'legacy/document.json', updatedAt: '2026-06-04T01:00:00.000Z' },
      blueprintWorkspace: { path: 'legacy/blueprints.json', updatedAt: '2026-06-04T02:00:00.000Z' },
      liveDraft: { status: 'unexpected', version: 2.9, partialPath: 'legacy.partial', updatedAt: '', byteLength: 42.5 },
    }, { now: '2026-06-05T00:00:00.000Z' })).toEqual({
      projectFormatVersion: EASYANALYSE_PROJECT_FORMAT_VERSION,
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
      workingCopy: {
        documentPath: EASYANALYSE_PROJECT_DOCUMENT_RELATIVE_PATH,
        updatedAt: '2026-06-04T01:00:00.000Z',
      },
      blueprintWorkspace: {
        path: EASYANALYSE_PROJECT_BLUEPRINT_WORKSPACE_RELATIVE_PATH,
        updatedAt: '2026-06-04T02:00:00.000Z',
      },
      liveDraft: {
        status: 'active',
        version: 2,
        partialPath: LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH,
        updatedAt: '2026-06-05T00:00:00.000Z',
        byteLength: 42,
      },
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  createProjectManifest,
  getProjectBlueprintDocumentPath,
  getProjectLiveDraftPartialPath,
  getProjectSimulationManifestPath,
  getProjectSimulationWorkerPath,
  getProjectWorkingCopyPath,
  isEasyAnalyseProjectDirectory,
} from './easyAnalyseProject'

describe('easyAnalyseProject', () => {
  it('creates stable project manifests with canonical paths', () => {
    const manifest = createProjectManifest({
      title: 'Filter Project',
      projectId: 'project-filter',
      activeBlueprintId: 'bp-main',
      now: '2026-06-01T00:00:00.000Z',
    })

    expect(manifest).toEqual({
      projectVersion: '1.0.0',
      projectId: 'project-filter',
      title: 'Filter Project',
      activeBlueprintId: 'bp-main',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      paths: {
        workingCopyDocument: 'working-copy/document.json',
        liveDraftPartial: 'working-copy/live-draft.raw.json.partial',
        blueprintsDirectory: 'blueprints',
        simulationsDirectory: 'simulations',
        agentThreads: 'agent/threads.json',
      },
    })
  })

  it('derives project child paths without allowing path separators in blueprint ids', () => {
    const root = 'C:\\work\\demo.easyanalyse'

    expect(isEasyAnalyseProjectDirectory(root)).toBe(true)
    expect(getProjectWorkingCopyPath(root)).toBe('C:/work/demo.easyanalyse/working-copy/document.json')
    expect(getProjectLiveDraftPartialPath(root)).toBe('C:/work/demo.easyanalyse/working-copy/live-draft.raw.json.partial')
    expect(getProjectBlueprintDocumentPath(root, '../bp main')).toBe('C:/work/demo.easyanalyse/blueprints/bp-main/document.json')
    expect(getProjectSimulationManifestPath(root, 'bp main')).toBe('C:/work/demo.easyanalyse/blueprints/bp-main/simulation.json')
    expect(getProjectSimulationWorkerPath(root, 'bp main')).toBe('C:/work/demo.easyanalyse/blueprints/bp-main/simulation.worker.js')
  })
})

import type { AgentThreadWorkspace } from './agentThread'
import type { BlueprintWorkspaceFile } from './blueprint'
import type { DocumentFile } from './document'

export type EasyAnalyseProjectVersion = '1.0.0'

export interface EasyAnalyseProjectManifest {
  projectVersion: EasyAnalyseProjectVersion
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
  activeBlueprintId?: string
  paths: {
    workingCopyDocument: 'working-copy/document.json'
    liveDraftPartial: 'working-copy/live-draft.raw.json.partial'
    blueprintsDirectory: 'blueprints'
    simulationsDirectory: 'simulations'
    agentThreads: 'agent/threads.json'
  }
}

export interface EasyAnalyseProjectSnapshot {
  manifest: EasyAnalyseProjectManifest
  workingCopy: DocumentFile
  blueprintWorkspace: BlueprintWorkspaceFile
  agentThreads?: AgentThreadWorkspace
}

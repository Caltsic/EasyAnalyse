import type { BlueprintWorkspaceFile } from '../types/blueprint'
import type { DocumentFile } from '../types/document'
import type { EasyAnalyseProjectManifest } from '../types/project'

const PROJECT_VERSION = '1.0.0' satisfies EasyAnalyseProjectManifest['projectVersion']

export const PROJECT_PATHS: EasyAnalyseProjectManifest['paths'] = {
  workingCopyDocument: 'working-copy/document.json',
  liveDraftPartial: 'working-copy/live-draft.raw.json.partial',
  blueprintsDirectory: 'blueprints',
  simulationsDirectory: 'simulations',
  agentThreads: 'agent/threads.json',
}

export function createProjectManifest(input: {
  projectId?: string
  title: string
  activeBlueprintId?: string
  now?: string
}): EasyAnalyseProjectManifest {
  const now = input.now ?? new Date().toISOString()
  return {
    projectVersion: PROJECT_VERSION,
    projectId: input.projectId ?? createProjectId(input.title),
    title: input.title,
    createdAt: now,
    updatedAt: now,
    ...(input.activeBlueprintId ? { activeBlueprintId: input.activeBlueprintId } : {}),
    paths: PROJECT_PATHS,
  }
}

export function isEasyAnalyseProjectDirectory(path: string): boolean {
  return normalizeSlashes(path).toLowerCase().endsWith('.easyanalyse')
}

export function joinProjectPath(projectPath: string, relativePath: string): string {
  const root = normalizeSlashes(projectPath).replace(/\/+$/u, '')
  const child = normalizeSlashes(relativePath).replace(/^\/+/u, '')
  return `${root}/${child}`
}

export function getProjectWorkingCopyPath(projectPath: string): string {
  return joinProjectPath(projectPath, PROJECT_PATHS.workingCopyDocument)
}

export function getProjectLiveDraftPartialPath(projectPath: string): string {
  return joinProjectPath(projectPath, PROJECT_PATHS.liveDraftPartial)
}

export function getProjectBlueprintDocumentPath(projectPath: string, blueprintId: string): string {
  return joinProjectPath(projectPath, `${PROJECT_PATHS.blueprintsDirectory}/${sanitizePathSegment(blueprintId)}/document.json`)
}

export function getProjectSimulationManifestPath(projectPath: string, blueprintId: string): string {
  return joinProjectPath(projectPath, `${PROJECT_PATHS.blueprintsDirectory}/${sanitizePathSegment(blueprintId)}/simulation.json`)
}

export function getProjectSimulationWorkerPath(projectPath: string, blueprintId: string): string {
  return joinProjectPath(projectPath, `${PROJECT_PATHS.blueprintsDirectory}/${sanitizePathSegment(blueprintId)}/simulation.worker.js`)
}

export function serializeProjectJson(value: EasyAnalyseProjectManifest | DocumentFile | BlueprintWorkspaceFile): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function createProjectId(title: string): string {
  const stem = title.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
  return `project-${stem || 'easyanalyse'}`
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-|-$/gu, '')
  return sanitized || 'blueprint'
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/gu, '/')
}

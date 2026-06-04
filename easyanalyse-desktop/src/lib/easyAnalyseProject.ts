export const EASYANALYSE_PROJECT_EXTENSION = '.easyanalyse'
export const LIVE_BLUEPRINT_DRAFT_PARTIAL_RELATIVE_PATH = 'working-copy/live-draft.raw.json.partial'

export function isEasyAnalyseProjectPath(path: string | null | undefined): boolean {
  if (!path) return false
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalized.endsWith(EASYANALYSE_PROJECT_EXTENSION)
}

export type AgentThreadWorkspaceSchemaVersion = 'agent-threads-v1'
export type AgentThreadStatus = 'active' | 'archived'
export type AgentThreadMessageRole = 'user' | 'assistant' | 'tool'
export type AgentThreadToolMessageStatus = 'running' | 'success' | 'error'

export interface AgentThreadMessageBase {
  id: string
  role: AgentThreadMessageRole
  createdAt: string
}

export interface AgentThreadUserMessage extends AgentThreadMessageBase {
  role: 'user'
  content: string
}

export interface AgentThreadAssistantMessage extends AgentThreadMessageBase {
  role: 'assistant'
  content: string
}

export interface AgentThreadToolMessage extends AgentThreadMessageBase {
  role: 'tool'
  toolName: string
  status: AgentThreadToolMessageStatus
  summary: string
  blueprintIds: string[]
  issueCount: number
}

export type AgentThreadMessage =
  | AgentThreadUserMessage
  | AgentThreadAssistantMessage
  | AgentThreadToolMessage

export interface AgentThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: AgentThreadStatus
  messages: AgentThreadMessage[]
}

export interface AgentThreadWorkspace {
  schemaVersion: AgentThreadWorkspaceSchemaVersion
  selectedThreadId: string | null
  threads: AgentThread[]
}

export interface AppendAgentThreadToolMessageInput {
  toolName: string
  status: AgentThreadToolMessageStatus
  summary?: string
  blueprintIds?: string[]
  issueCount?: number
}

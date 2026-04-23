import type { DiscussionState } from '@/lib/agents'

export interface RoomListItem {
  id: string
  topic: string
  createdAt: number
  updatedAt: number
  state: DiscussionState
  workspace?: string
  preview?: string
  agentCount: number
}

export interface RoomSkillSummary {
  effectiveSkills: Array<{ name: string; mode: 'auto' | 'required'; sourceLabel: string }>
  globalSkillCount: number
  workspaceDiscoveredCount: number
}

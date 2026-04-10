export type DiscussionState = 'INIT' | 'RESEARCH' | 'DEBATE' | 'CONVERGING' | 'DONE';
export type AgentRole = 'HOST' | 'AGENT';
export type MessageType = 'system' | 'statement' | 'question' | 'rebuttal' | 'summary' | 'report' | 'user_action';

export interface Agent {
  id: string;
  role: AgentRole;
  /** Agent persona name, e.g. "司马迁", "马斯克", "主持人" */
  name: string;
  /** Domain label for persona lookup */
  domainLabel: string;
  status: 'idle' | 'thinking' | 'waiting' | 'done';
}

export interface Message {
  id: string;
  agentRole: AgentRole | 'USER';
  agentName: string;
  content: string;
  timestamp: number;
  type: MessageType;
  /** Reasoning/thinking content (populated after streaming completes) */
  thinking?: string;
  /** Streaming timing stats (populated after streaming completes) */
  duration_ms?: number;
  total_cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  /** Temporary ID used during streaming (replaced by real id after completion) */
  tempMsgId?: string;
}

export interface DiscussionRoom {
  id: string;
  topic: string;
  state: DiscussionState;
  agents: Agent[];
  messages: Message[];
  report?: string;
  createdAt: number;
  updatedAt: number;
  /** agentId → session ID for CLI resume/continue support */
  sessionIds: Record<string, string>;
}

export type DiscussionState = 'INIT' | 'RESEARCH' | 'DEBATE' | 'CONVERGING' | 'DONE';
export type AgentRole = 'HOST' | 'SPECIALIST_A' | 'SPECIALIST_B';
export type MessageType = 'system' | 'statement' | 'question' | 'rebuttal' | 'summary' | 'report';

export interface Agent {
  id: string;
  role: AgentRole;
  name: string;
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
}

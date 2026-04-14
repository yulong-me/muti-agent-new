// F004: Manager 路由器 - 简化状态机
export type DiscussionState = 'RUNNING' | 'DONE';
// Agent 角色：MANAGER 只调度不执行，WORKER 执行具体任务
export type AgentRole = 'MANAGER' | 'WORKER';
export type MessageType = 'system' | 'statement' | 'question' | 'rebuttal' | 'summary' | 'report' | 'user_action' | 'a2a_handoff';

// A2A 上下文 — 追踪调用链和深度
export interface A2AContext {
  depth: number;                    // 当前深度 0-4
  callChain: string[];             // ['manager', 'workerA', 'workerB', ...]
  taskSummary: string;             // 任务摘要，供 Manager 决策
  roomId: string;
}

export interface A2ARouteResult {
  type: 'agent_route' | 'manager_handoff';
  targetAgentId?: string;
  depth: number;
  callChain: string[];
  taskSummary?: string;
}

// Provider 流式事件类型
export type ProviderEvent =
  | { type: 'start'; agentId: string; timestamp: number; messageId: string }
  | { type: 'delta'; agentId: string; text: string }
  | { type: 'thinking_delta'; agentId: string; thinking: string }
  | { type: 'end'; agentId: string; duration_ms: number; total_cost_usd: number; input_tokens: number; output_tokens: number; sessionId?: string }
  | { type: 'error'; agentId: string; message: string };

export interface Agent {
  id: string;
  role: AgentRole;
  /** Agent persona name, e.g. "架构师", "Reviewer", "主持人" */
  name: string;
  /** Domain label for persona display */
  domainLabel: string;
  /** Reference to agent config ID in agentsRepo (enables id-based lookup, avoids name collision) */
  configId: string;
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
  /** A2A 调用链信息 */
  a2aContext?: {
    depth: number;
    callChain: string[];
  };
  /** F0042: 直接路由的接收人 agentId（MANAGER 时为空） */
  toAgentId?: string;
}

export interface DiscussionRoom {
  id: string;
  topic: string;
  state: DiscussionState;
  agents: Agent[];
  messages: Message[];
  report?: string;
  /** F006: 自定义工作目录，留空则使用 workspaces/room-{id}/ */
  workspace?: string;
  createdAt: number;
  updatedAt: number;
  /** agentId → session ID for CLI resume/continue support */
  sessionIds: Record<string, string>;
  /** A2A 深度追踪（每次 A2A 调用递增） */
  a2aDepth: number;
  /** A2A 调用链 */
  a2aCallChain: string[];
}

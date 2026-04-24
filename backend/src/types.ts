// F004: 简化状态机
export type DiscussionState = 'RUNNING' | 'DONE';
// Agent 角色：运行期只会创建 WORKER；保留 MANAGER 仅用于兼容历史数据
export type AgentRole = 'MANAGER' | 'WORKER';
export type MessageType = 'system' | 'statement' | 'question' | 'rebuttal' | 'summary' | 'report' | 'user_action' | 'a2a_handoff';
export type AgentExecutionErrorCode =
  | 'AGENT_TIMEOUT'
  | 'AGENT_PROCESS_EXIT'
  | 'AGENT_PROVIDER_ERROR'
  | 'AGENT_PARSE_ERROR'
  | 'AGENT_STOPPED'
  | 'AGENT_RUNTIME_ERROR';

export interface AgentRunError {
  traceId: string;
  messageId?: string;
  agentId: string;
  agentName: string;
  code: AgentExecutionErrorCode | string;
  timeoutPhase?: 'first_token' | 'idle';
  title: string;
  message: string;
  retryable: boolean;
  originalUserContent?: string;
  toAgentId?: string;
  toAgentName?: string;
}

// A2A 上下文 — 追踪调用链和深度
export interface A2AContext {
  depth: number;                    // 当前深度 0..n
  callChain: string[];             // ['workerA', 'workerB', ...]
  taskSummary: string;             // 任务摘要，供深度限制提示或调试使用
  roomId: string;
}

export interface A2ARouteResult {
  type: 'agent_route' | 'depth_limited';
  targetAgentId?: string;
  depth: number;
  callChain: string[];
  taskSummary?: string;
}

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

export interface ToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
  callId?: string;
  timestamp?: number;
}

export interface InvocationUsage {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  lastTurnInputTokens?: number;
  contextWindowSize?: number;
  costUsd?: number;
  latencyMs?: number;
}

export interface ContextHealth {
  usedTokens: number;
  windowSize: number;
  leftTokens: number;
  leftPct: number;
  fillRatio: number;
  source: 'exact' | 'approx';
  state: 'healthy' | 'warn' | 'danger';
}

export interface SessionTelemetry {
  sessionId: string;
  invocationUsage?: InvocationUsage;
  contextHealth?: ContextHealth;
  measuredAt: number;
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
  /** Tool calls emitted during the agent run, persisted for message replay */
  toolCalls?: ToolCall[];
  /** Streaming timing stats (populated after streaming completes) */
  duration_ms?: number;
  total_cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  sessionId?: string;
  invocationUsage?: InvocationUsage;
  contextHealth?: ContextHealth;
  /** Temporary ID used during streaming (replaced by real id after completion) */
  tempMsgId?: string;
  /** A2A 调用链信息 */
  a2aContext?: {
    depth: number;
    callChain: string[];
  };
  /** F0042: 直接路由的接收人 agentId */
  toAgentId?: string;
  /** F014: structured agent execution error persisted for reconnect/poll recovery */
  runError?: AgentRunError;
  /** Canonical mention targets derived from the backend's effective routing rules */
  effectiveMentions?: string[];
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
  /** F016: 场景 ID，默认为 roundtable-forum */
  sceneId: string;
  createdAt: number;
  updatedAt: number;
  /** agentConfigId → session ID for CLI resume/continue support */
  sessionIds: Record<string, string>;
  /** agentConfigId → latest session telemetry snapshot */
  sessionTelemetryByAgent?: Record<string, SessionTelemetry>;
  /** A2A 深度追踪（每次 A2A 调用递增） */
  a2aDepth: number;
  /** A2A 调用链 */
  a2aCallChain: string[];
  /** F017: Room 级最大 A2A 深度覆盖，null=继承 scene 默认值 */
  maxA2ADepth: number | null;
}

// F016: Scene 配置
export interface SceneConfig {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  builtin: boolean;
  /** F017: Scene 默认 A2A 最大深度，0=无限 */
  maxA2ADepth: number;
}

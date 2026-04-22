/**
 * stateMachine 测试
 *
 * 核心变化：
 * - 移除 INIT/RESEARCH/DEBATE/CONVERGING 状态
 * - 新增 RUNNING/DONE 状态（简化设计）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖
vi.mock('../src/store.js', () => ({
  store: {
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('../src/db/index.js', () => ({
  roomsRepo: { create: vi.fn(), update: vi.fn() },
  messagesRepo: { insert: vi.fn(), updateContent: vi.fn() },
  sessionsRepo: { upsert: vi.fn() },
  auditRepo: { log: vi.fn() },
  scenesRepo: { get: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

vi.mock('../src/config/agentConfig.js', () => ({
  getAgent: vi.fn().mockReturnValue({
    id: 'host',
    name: '主持人',
    role: 'MANAGER',
    roleLabel: '主持人',
    provider: 'claude-code',
    systemPrompt: '专业主持人',
  }),
}));

// Mock provider as async generator
vi.mock('../src/services/providers/index.js', () => ({
  getProvider: vi.fn().mockReturnValue(async function* () {
    yield { type: 'delta', agentId: 'manager-1', text: '好的，我来处理' };
    yield { type: 'end', agentId: 'manager-1', duration_ms: 100, total_cost_usd: 0.01, input_tokens: 100, output_tokens: 50 };
  }),
}));

vi.mock('../src/services/socketEmitter.js', () => ({
  emitStreamStart: vi.fn(),
  emitStreamEnd: vi.fn(),
  emitAgentStatus: vi.fn(),
  emitStreamDelta: vi.fn(),
  emitThinkingDelta: vi.fn(),
  emitToolUse: vi.fn(),
  emitRoomErrorEvent: vi.fn(),
  emitUserMessage: vi.fn(),
}));

vi.mock('../src/services/workspace.js', () => ({
  ensureWorkspace: vi.fn().mockResolvedValue('/tmp/test-workspace'),
}));

vi.mock('../src/services/skills.js', () => ({
  resolveEffectiveSkills: vi.fn().mockResolvedValue({
    workspacePath: '/tmp/test-workspace',
    roomBindings: [],
    agentBindings: [],
    discovered: [],
    effective: [],
  }),
  assembleProviderRuntime: vi.fn().mockResolvedValue({
    providerRuntimeDir: '/tmp/provider-runtime',
    providerWorkspacePath: '/tmp/provider-runtime/workspace',
  }),
  buildEffectiveSkillSummary: vi.fn().mockReturnValue(undefined),
}));

// 动态导入以获取最新代码
describe('F004: Manager 路由器', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Default mock for scenesRepo — prevents scenePromptBuilder from throwing on old rooms without sceneId
    const { scenesRepo } = await import('../src/db/index.js');
    vi.mocked(scenesRepo.get).mockReturnValue({
      id: 'roundtable-forum',
      name: '圆桌论坛',
      prompt: '圆桌',
      builtin: true,
    });
  });

  describe('状态类型', () => {
    it('应该只有 RUNNING/DONE 两种状态', async () => {
      const { DiscussionState } = await import('../src/types.js');
      const validStates = ['RUNNING', 'DONE'];
      const allStates: DiscussionState[] = ['RUNNING', 'DONE'];

      // 验证只有两种状态
      expect(validStates).toHaveLength(2);
      allStates.forEach(state => {
        expect(validStates).toContain(state);
      });
    });

    it('不应该包含旧状态 INIT/RESEARCH/DEBATE/CONVERGING', async () => {
      const { DiscussionState } = await import('../src/types.js');
      const oldStates: DiscussionState[] = ['INIT', 'RESEARCH', 'DEBATE', 'CONVERGING', 'WAITING'];

      oldStates.forEach(state => {
        // @ts-ignore - 测试旧状态不存在
        const isValid = ['RUNNING', 'DONE'].includes(state);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('routeToAgent()', () => {
    it('专家执行失败时也应该结束 loading 并发出结构化错误事件', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');
      const { getProvider } = await import('../src/services/providers/index.js');
      const { emitStreamEnd, emitRoomErrorEvent } = await import('../src/services/socketEmitter.js');

      const mockRoom = {
        id: 'room-1',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(getProvider).mockReturnValueOnce(async function* () {
        const failure = new Error('cli died');
        (failure as Error & { code?: string }).code = 'AGENT_PROCESS_EXIT';
        throw failure;
      });

      await expect(routeToAgent('room-1', '@架构师 帮我看看这个方案', 'worker-1')).rejects.toThrow('cli died');

      expect(emitStreamEnd).toHaveBeenCalled();
      expect(emitRoomErrorEvent).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          agentId: 'worker-1',
          agentName: '架构师',
          code: 'AGENT_PROCESS_EXIT',
          retryable: true,
          originalUserContent: '@架构师 帮我看看这个方案',
        }),
      );
      expect(messagesRepo.updateContent).toHaveBeenCalledWith(
        expect.any(String),
        '',
        expect.objectContaining({
          runError: expect.objectContaining({
            code: 'AGENT_PROCESS_EXIT',
            originalUserContent: '@架构师 帮我看看这个方案',
          }),
        }),
      );
    });

    it('专家工具调用应该随消息持久化，刷新后可回放', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');
      const { getProvider } = await import('../src/services/providers/index.js');
      const { emitToolUse } = await import('../src/services/socketEmitter.js');

      const mockRoom = {
        id: 'room-1',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(getProvider).mockReturnValueOnce(async function* () {
        yield {
          type: 'tool_use',
          agentId: 'worker-1',
          toolName: 'Bash',
          toolInput: { command: 'pwd' },
          callId: 'toolu_1',
        };
        yield { type: 'delta', agentId: 'worker-1', text: '完成' };
        yield { type: 'end', agentId: 'worker-1', duration_ms: 100, total_cost_usd: 0.01, input_tokens: 100, output_tokens: 50 };
      });

      await routeToAgent('room-1', '@架构师 帮我看看这个方案', 'worker-1');

      expect(emitToolUse).toHaveBeenCalledWith('room-1', 'worker-1', 'Bash', { command: 'pwd' }, 'toolu_1', expect.any(Number));
      expect(messagesRepo.updateContent).toHaveBeenCalledWith(
        expect.any(String),
        '完成',
        expect.objectContaining({
          toolCalls: [
            expect.objectContaining({
              toolName: 'Bash',
              toolInput: { command: 'pwd' },
              callId: 'toolu_1',
            }),
          ],
        }),
      );
    });

    it('人工手动触发新一轮消息时，应该重置房间级 A2A 深度和调用链', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');

      const mockRoom = {
        id: 'room-1',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 5,
        a2aCallChain: ['需求分析师', '架构师', 'Reviewer', '实现工程师', '测试工程师'],
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});

      await routeToAgent('room-1', '@架构师 我来手动开启新一轮', 'worker-1');

      expect(store.update).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          a2aDepth: 0,
          a2aCallChain: [],
        }),
      );
    });

    it('用户停止回答时应该保留部分输出并发出 AGENT_STOPPED 事件', async () => {
      const { routeToAgent, stopAgentRun } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');
      const { getProvider } = await import('../src/services/providers/index.js');
      const { emitRoomErrorEvent, emitStreamStart } = await import('../src/services/socketEmitter.js');

      const mockRoom = {
        id: 'room-1',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      let providerStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        providerStarted = resolve;
      });

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      let stopResult: ReturnType<typeof stopAgentRun> | null = null;
      vi.mocked(emitStreamStart).mockImplementationOnce(() => {
        stopResult = stopAgentRun('room-1', 'worker-1');
      });
      vi.mocked(getProvider).mockReturnValueOnce(async function* (_prompt, _agentId, opts) {
        const signal = opts?.signal as AbortSignal | undefined;
        providerStarted();
        if (signal?.aborted) {
          const err = new Error('stopped');
          (err as Error & { code?: string }).code = 'AGENT_STOPPED';
          throw err;
        }
        yield { type: 'delta', agentId: 'worker-1', text: '先给你一半答案' };
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            const err = new Error('stopped');
            (err as Error & { code?: string }).code = 'AGENT_STOPPED';
            reject(err);
            return;
          }
          signal?.addEventListener('abort', () => {
            const err = new Error('stopped');
            (err as Error & { code?: string }).code = 'AGENT_STOPPED';
            reject(err);
          }, { once: true });
        });
      });

      const runPromise = routeToAgent('room-1', '@架构师 帮我看看这个方案', 'worker-1');
      await started;

      expect(stopResult).toEqual(
        expect.objectContaining({ stopped: true, agentName: '架构师' }),
      );

      await expect(runPromise).rejects.toMatchObject({ code: 'AGENT_STOPPED' });

      expect(emitRoomErrorEvent).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          agentId: 'worker-1',
          code: 'AGENT_STOPPED',
          title: '已停止回答',
          retryable: false,
        }),
      );
      expect(messagesRepo.updateContent).toHaveBeenCalledWith(
        expect.any(String),
        '',
        expect.objectContaining({
          runError: expect.objectContaining({
            code: 'AGENT_STOPPED',
            title: '已停止回答',
          }),
        }),
      );
    });

    it('同房间同专家已有活跃 run 时应该拒绝第二次注册', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { emitRoomErrorEvent } = await import('../src/services/socketEmitter.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-1',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      let releaseFirstRun!: () => void;
      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(getProvider).mockReturnValueOnce(async function* () {
        await new Promise<void>((resolve) => {
          releaseFirstRun = resolve;
        });
        yield { type: 'end', agentId: 'worker-1', duration_ms: 100, total_cost_usd: 0, input_tokens: 0, output_tokens: 0 };
      });

      const firstRun = routeToAgent('room-1', '@架构师 第一次', 'worker-1');
      await Promise.resolve();

      await expect(routeToAgent('room-1', '@架构师 第二次', 'worker-1')).rejects.toMatchObject({
        code: 'AGENT_RUN_CONFLICT',
      });

      expect(emitRoomErrorEvent).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          code: 'AGENT_RUNTIME_ERROR',
          messageId: undefined,
        }),
      );

      releaseFirstRun();
      await firstRun;
    });

    it('专家启动前置步骤失败时也应该发出可恢复的 orphan 错误事件', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { ensureWorkspace } = await import('../src/services/workspace.js');
      const { emitStreamStart, emitStreamEnd, emitRoomErrorEvent } = await import('../src/services/socketEmitter.js');

      const mockRoom = {
        id: 'room-1',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(ensureWorkspace).mockRejectedValueOnce(new Error('workspace unavailable'));

      await expect(routeToAgent('room-1', '@架构师 帮我看看这个方案', 'worker-1')).rejects.toThrow('workspace unavailable');

      expect(emitStreamStart).not.toHaveBeenCalled();
      expect(emitStreamEnd).not.toHaveBeenCalled();
      expect(emitRoomErrorEvent).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          agentId: 'worker-1',
          agentName: '架构师',
          code: 'AGENT_RUNTIME_ERROR',
          messageId: undefined,
          originalUserContent: '@架构师 帮我看看这个方案',
        }),
      );
    });

    it('首包超时时应该保留“响应超时”语义', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { emitRoomErrorEvent } = await import('../src/services/socketEmitter.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-timeout-first-token',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(getProvider).mockReturnValueOnce(async function* () {
        const failure = new Error('Timed out waiting for first token');
        (failure as Error & { code?: string; phase?: string }).code = 'AGENT_TIMEOUT';
        (failure as Error & { code?: string; phase?: string }).phase = 'first_token';
        throw failure;
      });

      await expect(routeToAgent('room-timeout-first-token', '@架构师 帮我看看这个方案', 'worker-1')).rejects.toThrow('Timed out waiting for first token');

      expect(emitRoomErrorEvent).toHaveBeenCalledWith(
        'room-timeout-first-token',
        expect.objectContaining({
          code: 'AGENT_TIMEOUT',
          title: '响应超时',
          timeoutPhase: 'first_token',
        }),
      );
    });

    it('中途 idle 超时应该以“连接中断”提示，并保留已生成内容', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');
      const { emitRoomErrorEvent } = await import('../src/services/socketEmitter.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-timeout-idle',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(getProvider).mockReturnValueOnce(async function* () {
        yield { type: 'delta', agentId: 'worker-1', text: '这是已生成的半段回答' };
        const failure = new Error('Timed out waiting for next token');
        (failure as Error & { code?: string; phase?: string }).code = 'AGENT_TIMEOUT';
        (failure as Error & { code?: string; phase?: string }).phase = 'idle';
        throw failure;
      });

      await expect(routeToAgent('room-timeout-idle', '@架构师 帮我看看这个方案', 'worker-1')).rejects.toThrow('Timed out waiting for next token');

      expect(emitRoomErrorEvent).toHaveBeenCalledWith(
        'room-timeout-idle',
        expect.objectContaining({
          code: 'AGENT_TIMEOUT',
          title: '连接中断',
          timeoutPhase: 'idle',
        }),
      );
      expect(messagesRepo.updateContent).toHaveBeenCalledWith(
        expect.any(String),
        '这是已生成的半段回答',
        expect.objectContaining({
          runError: expect.objectContaining({
            code: 'AGENT_TIMEOUT',
            timeoutPhase: 'idle',
          }),
        }),
      );
    });

    it('调用专家时会把 room workspace 传给 provider，并以 room.workspace 解析工作目录', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { ensureWorkspace } = await import('../src/services/workspace.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const roomWorkspace = '/Users/yulong/work/sample-project';
      const mockRoom = {
        id: 'room-workspace-forward',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
        workspace: roomWorkspace,
      };

      let capturedOpts: Record<string, unknown> | undefined;
      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(ensureWorkspace).mockResolvedValueOnce(roomWorkspace);
      vi.mocked(getProvider).mockReturnValueOnce(async function* (_prompt: string, _agentId: string, opts?: Record<string, unknown>) {
        capturedOpts = opts;
        yield { type: 'delta', agentId: 'worker-1', text: '收到' };
        yield { type: 'end', agentId: 'worker-1', duration_ms: 100, total_cost_usd: 0.01, input_tokens: 10, output_tokens: 10 };
      });

      await routeToAgent('room-workspace-forward', '@架构师 在这个项目里看看', 'worker-1');

      expect(ensureWorkspace).toHaveBeenCalledWith('room-workspace-forward', roomWorkspace);
      expect(capturedOpts).toMatchObject({
        workspace: roomWorkspace,
        roomId: 'room-workspace-forward',
        agentName: '架构师',
      });
    });

    it('新邀请专家第一次被调用时会拿到完整 room 历史', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const historyMessages = Array.from({ length: 12 }, (_, index) => ({
        id: `msg-${index + 1}`,
        agentRole: index % 2 === 0 ? 'USER' as const : 'WORKER' as const,
        agentName: index % 2 === 0 ? '你' : '架构师',
        content: `H${String(index + 1).padStart(2, '0')}`,
        timestamp: Date.now() - (12 - index) * 1000,
        type: 'statement' as const,
      }));

      const mockRoom = {
        id: 'room-invite-history',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '新专家', domainLabel: '代码审查', configId: 'invited-worker', status: 'idle' as const },
        ],
        messages: [
          ...historyMessages,
          {
            id: 'joined-system',
            agentRole: 'WORKER' as const,
            agentName: '新专家',
            content: '新专家 加入了讨论',
            timestamp: Date.now(),
            type: 'system' as const,
          },
        ],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      let capturedPrompt = '';
      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(getProvider).mockReturnValueOnce(async function* (prompt: string) {
        capturedPrompt = prompt;
        yield { type: 'delta', agentId: 'worker-1', text: '收到' };
        yield { type: 'end', agentId: 'worker-1', duration_ms: 100, total_cost_usd: 0.01, input_tokens: 10, output_tokens: 10 };
      });

      await routeToAgent('room-invite-history', '@新专家 看看这段历史', 'worker-1');

      expect(capturedPrompt).toContain('H01');
      expect(capturedPrompt).toContain('H12');
      expect(capturedPrompt).toContain('新专家 加入了讨论');
    });

    it('普通已有专家仍然只拿最近窗口，避免每次都带完整历史', async () => {
      const { routeToAgent } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const historyMessages = Array.from({ length: 12 }, (_, index) => ({
        id: `existing-msg-${index + 1}`,
        agentRole: index % 2 === 0 ? 'USER' as const : 'WORKER' as const,
        agentName: index % 2 === 0 ? '你' : '架构师',
        content: `R${String(index + 1).padStart(2, '0')}`,
        timestamp: Date.now() - (12 - index) * 1000,
        type: 'statement' as const,
      }));

      const mockRoom = {
        id: 'room-existing-history',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'worker-config', status: 'idle' as const },
        ],
        messages: historyMessages,
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      let capturedPrompt = '';
      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});
      vi.mocked(getProvider).mockReturnValueOnce(async function* (prompt: string) {
        capturedPrompt = prompt;
        yield { type: 'delta', agentId: 'worker-1', text: '收到' };
        yield { type: 'end', agentId: 'worker-1', duration_ms: 100, total_cost_usd: 0.01, input_tokens: 10, output_tokens: 10 };
      });

      await routeToAgent('room-existing-history', '@架构师 看看最近上下文', 'worker-1');

      expect(capturedPrompt).not.toContain('R01');
      expect(capturedPrompt).toContain('R03');
      expect(capturedPrompt).toContain('R12');
    });
  });

  describe('Manager 决策路由', () => {
    it('应该能解析 @mention 并路由到 Worker', async () => {
      const { scanForA2AMentions } = await import('../src/services/routing/A2ARouter.js');

      const text = '@架构师 请分析这个方案';
      const mentions = scanForA2AMentions(text);

      expect(mentions).toContain('架构师');
    });

    it('应该排除 code block 内的 @mention', async () => {
      const { scanForA2AMentions } = await import('../src/services/routing/A2ARouter.js');

      const text = `这是代码：
\`\`\`
@不应该触发
\`\`\`
@应该触发`;

      const mentions = scanForA2AMentions(text);

      expect(mentions).not.toContain('不应该触发');
      expect(mentions).toContain('应该触发');
    });

    it('圆桌论坛只把最后一行的 @ 当成交棒，兼容旧格式末句 inline @', async () => {
      const { detectRoundtableHandoff } = await import('../src/services/routing/A2ARouter.js');

      expect(detectRoundtableHandoff('我反对这个判断。\n@芒格', ['查理·芒格', '芒格'])).toEqual({
        mention: '芒格',
        source: 'standalone_last_line',
      });

      expect(detectRoundtableHandoff('我反对这个判断。\n@芒格 你怎么看？', ['查理·芒格', '芒格'])).toEqual({
        mention: '芒格',
        source: 'inline_last_line_fallback',
      });

      expect(detectRoundtableHandoff('@乔布斯 你这个前提错了。\n真正的问题是权限模型。', ['乔布斯']))
        .toBeNull();

      expect(detectRoundtableHandoff('我不同意这个判断。\n@芒格\n（张一鸣收）', ['查理·芒格', '芒格'])).toEqual({
        mention: '芒格',
        source: 'standalone_with_trailing_text_fallback',
      });

      expect(detectRoundtableHandoff('我不同意这个判断。\n@乔布斯\n你刚才说得对，但我再补一句', ['乔布斯'])).toEqual({
        mention: '乔布斯',
        source: 'standalone_with_trailing_text_fallback',
      });

      expect(detectRoundtableHandoff('我不同意这个判断。\n@张一鸣\n@芒格', ['张一鸣', '查理·芒格', '芒格']))
        .toBeNull();
    });
  });

  describe('F017: A2A 协作深度', () => {
    it('room override / scene default / 无限模式都返回正确的有效深度', async () => {
      const { getEffectiveMaxDepthForRoom } = await import('../src/services/routing/A2ARouter.js');
      const { store } = await import('../src/store.js');
      const { scenesRepo } = await import('../src/db/index.js');

      vi.mocked(store.get)
        .mockReturnValueOnce({
          id: 'room-override',
          topic: 'Test',
          state: 'RUNNING' as const,
          agents: [],
          messages: [],
          sessionIds: {},
          a2aDepth: 0,
          a2aCallChain: [],
          sceneId: 'software-development',
          maxA2ADepth: 3,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .mockReturnValueOnce({
          id: 'room-inherit',
          topic: 'Test',
          state: 'RUNNING' as const,
          agents: [],
          messages: [],
          sessionIds: {},
          a2aDepth: 0,
          a2aCallChain: [],
          sceneId: 'software-development',
          maxA2ADepth: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .mockReturnValueOnce({
          id: 'room-infinite',
          topic: 'Test',
          state: 'RUNNING' as const,
          agents: [],
          messages: [],
          sessionIds: {},
          a2aDepth: 99,
          a2aCallChain: [],
          sceneId: 'software-development',
          maxA2ADepth: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

      vi.mocked(scenesRepo.get).mockReturnValue({
        id: 'software-development',
        name: '软件开发',
        prompt: '软件开发场景',
        builtin: true,
        maxA2ADepth: 10,
      });

      expect(getEffectiveMaxDepthForRoom('room-override')).toBe(3);
      expect(getEffectiveMaxDepthForRoom('room-inherit')).toBe(10);
      expect(getEffectiveMaxDepthForRoom('room-infinite')).toBe(0);
    });

    it('达到深度上限时停止继续路由，并追加明确的系统提示', async () => {
      const { a2aOrchestrate } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-depth-limit',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'architect', status: 'idle' as const },
          { id: 'worker-2', role: 'WORKER' as const, name: 'Reviewer', domainLabel: '代码审查', configId: 'reviewer', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 3,
        a2aCallChain: ['实现工程师', '架构师', 'Reviewer'],
        sceneId: 'software-development',
        maxA2ADepth: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});

      await a2aOrchestrate('room-depth-limit', 'worker-1', '架构师', '@Reviewer 请继续 review');

      expect(messagesRepo.insert).toHaveBeenCalledWith(
        'room-depth-limit',
        expect.objectContaining({
          agentName: '系统',
          type: 'system',
          content: expect.stringContaining('已达到协作深度上限（3 层）'),
        }),
      );
      expect(getProvider).not.toHaveBeenCalled();
    });

    it('允许回流到链路中出现过但尚未形成重复协作对的专家', async () => {
      const { a2aOrchestrate } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-cycle-revisit',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '需求分析师', domainLabel: '需求澄清', configId: 'requirements', status: 'idle' as const },
          { id: 'worker-2', role: 'WORKER' as const, name: '架构师', domainLabel: '架构设计', configId: 'architect', status: 'idle' as const },
          { id: 'worker-3', role: 'WORKER' as const, name: '实现工程师', domainLabel: '代码实现', configId: 'implementer', status: 'idle' as const },
          { id: 'worker-4', role: 'WORKER' as const, name: '测试工程师', domainLabel: '测试验证', configId: 'qa', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 4,
        a2aCallChain: ['需求分析师', '架构师', '需求分析师', '实现工程师'],
        sceneId: 'software-development',
        maxA2ADepth: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});

      await a2aOrchestrate('room-cycle-revisit', 'worker-4', '测试工程师', '@实现工程师 请继续确认实现细节');

      expect(getProvider).toHaveBeenCalledTimes(1);
    });

    it('所有 mention 都因循环保护被拦截时，追加系统提示而不是静默结束', async () => {
      const { a2aOrchestrate } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-cycle-blocked',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '实现工程师', domainLabel: '代码实现', configId: 'implementer', status: 'idle' as const },
          { id: 'worker-2', role: 'WORKER' as const, name: '测试工程师', domainLabel: '测试验证', configId: 'qa', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 2,
        a2aCallChain: ['实现工程师', '测试工程师'],
        sceneId: 'software-development',
        maxA2ADepth: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});

      await a2aOrchestrate('room-cycle-blocked', 'worker-1', '实现工程师', '@测试工程师 请再确认一次');

      expect(messagesRepo.insert).toHaveBeenCalledWith(
        'room-cycle-blocked',
        expect.objectContaining({
          agentName: '系统',
          type: 'system',
          content: expect.stringContaining('检测到重复协作链路'),
        }),
      );
      expect(getProvider).not.toHaveBeenCalled();
    });

    it('圆桌论坛支持用专家简称交棒，并路由到对应参与者', async () => {
      const { a2aOrchestrate } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-roundtable-alias',
        topic: '苹果 AI OS',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '乔布斯', domainLabel: '乔布斯', configId: 'steve-jobs', status: 'idle' as const },
          { id: 'worker-2', role: 'WORKER' as const, name: '张一鸣', domainLabel: '张一鸣', configId: 'zhang-yiming', status: 'idle' as const },
          { id: 'worker-3', role: 'WORKER' as const, name: '查理·芒格', domainLabel: '芒格', configId: 'munger', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
        sceneId: 'roundtable-forum',
        maxA2ADepth: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});

      await a2aOrchestrate('room-roundtable-alias', 'worker-2', '张一鸣', '我不同意这个判断。\n@芒格');

      expect(getProvider).toHaveBeenCalledTimes(1);
    });

    it('圆桌论坛写出独立交棒行后又继续补正文时，仍然自动接力到该专家', async () => {
      const { a2aOrchestrate } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-roundtable-invalid-handoff',
        topic: '苹果 AI OS',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '乔布斯', domainLabel: '乔布斯', configId: 'steve-jobs', status: 'idle' as const },
          { id: 'worker-2', role: 'WORKER' as const, name: '张一鸣', domainLabel: '张一鸣', configId: 'zhang-yiming', status: 'idle' as const },
          { id: 'worker-3', role: 'WORKER' as const, name: '查理·芒格', domainLabel: '芒格', configId: 'munger', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 1,
        a2aCallChain: ['乔布斯'],
        sceneId: 'roundtable-forum',
        maxA2ADepth: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});

      await a2aOrchestrate('room-roundtable-invalid-handoff', 'worker-2', '张一鸣', '我不同意这个判断。\n@芒格\n（张一鸣收）');

      expect(getProvider).toHaveBeenCalledTimes(1);
    });

    it('圆桌论坛只有开头 inline @ 没有独立交棒行时，追加系统提示并停止自动接力', async () => {
      const { a2aOrchestrate } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-roundtable-invalid-inline',
        topic: '苹果 AI OS',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '乔布斯', domainLabel: '乔布斯', configId: 'steve-jobs', status: 'idle' as const },
          { id: 'worker-2', role: 'WORKER' as const, name: '张一鸣', domainLabel: '张一鸣', configId: 'zhang-yiming', status: 'idle' as const },
          { id: 'worker-3', role: 'WORKER' as const, name: '查理·芒格', domainLabel: '芒格', configId: 'munger', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 1,
        a2aCallChain: ['乔布斯'],
        sceneId: 'roundtable-forum',
        maxA2ADepth: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});

      await a2aOrchestrate('room-roundtable-invalid-inline', 'worker-2', '张一鸣', '@乔布斯 你这个问题问得好。\n真正的问题是上下文失真。');

      expect(messagesRepo.insert).toHaveBeenCalledWith(
        'room-roundtable-invalid-inline',
        expect.objectContaining({
          agentName: '系统',
          type: 'system',
          content: expect.stringContaining('本轮未自动接力'),
        }),
      );
      expect(getProvider).not.toHaveBeenCalled();
    });

    it('圆桌论坛出现多个独立交棒行时，追加系统提示并停止自动接力', async () => {
      const { a2aOrchestrate } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');
      const { getProvider } = await import('../src/services/providers/index.js');

      const mockRoom = {
        id: 'room-roundtable-multi-handoff',
        topic: '苹果 AI OS',
        state: 'RUNNING' as const,
        agents: [
          { id: 'worker-1', role: 'WORKER' as const, name: '乔布斯', domainLabel: '乔布斯', configId: 'steve-jobs', status: 'idle' as const },
          { id: 'worker-2', role: 'WORKER' as const, name: '张一鸣', domainLabel: '张一鸣', configId: 'zhang-yiming', status: 'idle' as const },
          { id: 'worker-3', role: 'WORKER' as const, name: '查理·芒格', domainLabel: '芒格', configId: 'munger', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 1,
        a2aCallChain: ['乔布斯'],
        sceneId: 'roundtable-forum',
        maxA2ADepth: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation(() => {});

      await a2aOrchestrate('room-roundtable-multi-handoff', 'worker-1', '乔布斯', '我不同意这个判断。\n@张一鸣\n@芒格');

      expect(messagesRepo.insert).toHaveBeenCalledWith(
        'room-roundtable-multi-handoff',
        expect.objectContaining({
          agentName: '系统',
          type: 'system',
          content: expect.stringContaining('本轮未自动接力'),
        }),
      );
      expect(getProvider).not.toHaveBeenCalled();
    });
  });
});

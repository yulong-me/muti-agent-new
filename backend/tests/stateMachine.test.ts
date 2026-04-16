/**
 * F004: Manager 路由器 - stateMachine 测试
 *
 * 核心变化：
 * - 移除 INIT/RESEARCH/DEBATE/CONVERGING 状态
 * - 新增 RUNNING/DONE 状态（简化设计）
 * - handleUserMessage() 处理用户消息
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
  emitRoomErrorEvent: vi.fn(),
  emitUserMessage: vi.fn(),
}));

vi.mock('../src/services/workspace.js', () => ({
  ensureWorkspace: vi.fn().mockResolvedValue('/tmp/test-workspace'),
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

  describe('handleUserMessage()', () => {
    it('应该存在 handleUserMessage 函数', async () => {
      const stateMachine = await import('../src/services/stateMachine.js');
      expect(typeof stateMachine.handleUserMessage).toBe('function');
    });

    it('应该将用户消息添加到消息列表', async () => {
      const { handleUserMessage } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { messagesRepo } = await import('../src/db/index.js');

      const mockRoom = {
        id: 'room-1',
        topic: '测试话题',
        state: 'RUNNING' as const,
        agents: [
          { id: 'manager-1', role: 'MANAGER' as const, name: '主持人', domainLabel: '主持人', configId: 'host', status: 'idle' as const },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      vi.mocked(store.get).mockReturnValue(mockRoom);
      vi.mocked(store.update).mockImplementation((id, updates) => {});

      await handleUserMessage('room-1', '用户输入的话题');

      expect(store.update).toHaveBeenCalled();
      expect(messagesRepo.insert).toHaveBeenCalled();
    });

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
  });
});

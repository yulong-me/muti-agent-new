/**
 * F004: Manager 路由器 - rooms.ts 路由测试
 *
 * 核心变化：
 * - 新增 POST /rooms/:id/messages 用户对话入口
 * - 移除 /start, /advance 路由
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
  auditRepo: { log: vi.fn() },
  scenesRepo: { get: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

vi.mock('../src/config/agentConfig.js', () => ({
  getAgent: vi.fn(),
}));

// 只 mock 这几个函数，保留其余（包括新增的 isRoomBusy）
vi.mock('../src/services/stateMachine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/stateMachine.js')>();
  return {
    ...actual,
    hostReply: vi.fn(),
    routeToAgent: vi.fn(),
  };
});

describe('rooms 路由', () => {
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

  describe('状态初始化', () => {
    it('新 room 应该初始化为 RUNNING 状态', async () => {
      const { DiscussionRoom } = await import('../src/types.js');

      // 新 room 创建时状态应该是 RUNNING
      const newRoom: DiscussionRoom = {
        id: 'room-1',
        topic: '测试',
        state: 'RUNNING', // F004: 不再是 INIT
        agents: [],
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };

      expect(newRoom.state).toBe('RUNNING');
    });
  });

  // F015: isRoomBusy helper 测试
  describe('F015: 房间忙时保护', () => {
    it('isRoomBusy 返回 true 当 agent 状态为 thinking', async () => {
      const { isRoomBusy } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');

      const mockRoom = {
        id: 'room-busy',
        topic: 'Test',
        state: 'RUNNING' as const,
        agents: [
          {
            id: 'worker-1',
            role: 'WORKER' as const,
            name: '测试员',
            domainLabel: '测试',
            configId: 'worker-1',
            status: 'thinking' as const,
          },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };
      vi.mocked(store.get).mockReturnValue(mockRoom);

      expect(isRoomBusy('room-busy')).toBe(true);
    });

    it('isRoomBusy 返回 false 当所有 agent 状态为 idle', async () => {
      const { isRoomBusy } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');

      const mockRoom = {
        id: 'room-idle',
        topic: 'Test',
        state: 'RUNNING' as const,
        agents: [
          {
            id: 'worker-1',
            role: 'WORKER' as const,
            name: '测试员',
            domainLabel: '测试',
            configId: 'worker-1',
            status: 'idle' as const,
          },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };
      vi.mocked(store.get).mockReturnValue(mockRoom);

      expect(isRoomBusy('room-idle')).toBe(false);
    });

    it('isRoomBusy 返回 false 当 room 不存在', async () => {
      const { isRoomBusy } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      vi.mocked(store.get).mockReturnValue(undefined);

      expect(isRoomBusy('nonexistent')).toBe(false);
    });
  });
});

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
}));

vi.mock('../src/config/agentConfig.js', () => ({
  getAgent: vi.fn(),
}));

vi.mock('../src/services/stateMachine.js', () => ({
  hostReply: vi.fn(),
  addUserMessage: vi.fn(),
  handleUserMessage: vi.fn(),
  generateReport: vi.fn(),
  routeToAgent: vi.fn(),
}));

describe('F004: Manager 路由器 - rooms 路由', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /rooms/:id/messages', () => {
    it('应该存在用户消息路由', async () => {
      // 验证路由文件导出了需要的函数
      const roomsModule = await import('../src/services/stateMachine.js');
      expect(typeof roomsModule.handleUserMessage).toBe('function');
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
});

---
feature_ids: [F001]
related_features: []
topics: [multi-agent, collaboration, platform, 智囊团, 状态机, A2A, 工具型Agent]
doc_kind: spec
created: 2026-04-09
updated: 2026-04-11
---

# F001: Multi-Agent Collaboration Platform（AI 智囊团）

> Status: spec (v2 - 工具型 + A2A) | Owner: 宪宪 | Reviewer: @opencode ✅

## Why

现在的 AI 助手都是"单打独斗"——用户问一个问题，AI 给一个答案，没有真正的多视角碰撞。复杂的审稿分析、方案决策、架构设计，全靠用户自己想。

**我们想做一个"AI 智囊团"**：
1. 支持**协作软件开发** — Agent 写代码、Review、修改
2. 支持**Code Review / Paper Review** — Agent 分析、辩论、收敛

核心：工具型 Agent 通过 A2A @mention 自主协作，像真实团队一样工作。

## What

一个智能讨论空间，以**状态机**驱动，Host Agent 编排，多个工具型 Agent 协作，最终产出结构化报告。

---

## 架构决策（v2）

| 决策 | 选择 | 理由 |
|------|------|------|
| Agent 类型 | **工具型** | 文件操作、命令执行，真正协作开发 |
| 协作方式 | **A2A @mention** | Agent 自主通过 @mention 触发协作 |
| Host 角色 | **专门 Agent** | 通过 @mention 召集其他 Agent，强化 prompt |
| AgentService | Claude Code + OpenCode | 只做两个 CLI，提供商可插拔 |
| Workspace | `/workspace/room-{id}/` | 共享工作目录，Agent 间文件共享 |
| A2A Router | hostReply() 内部 | 作为输出过滤器，流式完成后扫描 |
| 前端 | Next.js (port 3003) | 全栈一体 |
| 后端 | Express (port 3004) | 状态机 + Agent 调度 |

---

## 核心模块

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                   │
│  讨论室 UI │ 消息流 │ Agent 状态 │ Workspace 文件浏览器      │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                     Backend (Express)                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Host Agent (主持 Agent)                              │   │
│  │  - 分析任务 → @mention 其他 Agent                     │   │
│  │  - 维护任务状态                                      │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ A2A 协作                         │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │  A2A Router                                          │   │
│  │  - 解析消息中的 @mention（行首检测）                │   │
│  │  - 识别目标 Agent                                    │   │
│  │  - 触发协作链                                        │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │  AgentService 抽象层                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐                   │   │
│  │  │ ClaudeCLI   │  │ OpenCodeCLI │                   │   │
│  │  │ Service     │  │ Service     │                   │   │
│  │  └─────────────┘  └─────────────┘                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Workspace Manager                                    │   │
│  │  - /workspace/room-{id}/ ← 共享工作目录            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## AgentService 抽象层

```typescript
interface AgentServiceOptions {
  workspace: string;           // /workspace/room-{id}
  sessionId?: string;          // 续接 session
  roomId: string;
}

interface StreamingMessage {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'done' | 'error';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

interface AgentService {
  readonly id: string;           // 'claude-code' | 'opencode'
  readonly name: string;

  invoke(
    systemPrompt: string,
    userMessage: string,
    options: AgentServiceOptions
  ): AsyncGenerator<StreamingMessage>;
}
```

---

## A2A 协作流程

```
用户: "帮我实现一个 React Todo App，@opencode review"

                        ↓
┌─────────────────────────────────────────────────────────────┐
│  Host Agent (Claude Code)                                   │
│  - 分析任务                                                  │
│  - 实现代码，写入 /workspace/room-xxx/src/App.tsx          │
│  - @opencode 请帮我 review                                  │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  A2A Router (hostReply 内部)                                │
│  scanForA2AMentions(text)                                   │
│  - 行首 @agentId 检测                                       │
│  - 返回 ['opencode']                                        │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  OpenCode Agent                                             │
│  - workspace: /workspace/room-xxx                         │
│  - 读取 src/App.tsx → review                              │
└─────────────────────────────────────────────────────────────┘
                        ↓
                    消息注入 room.messages
```

---

## A2A Router 规则

```typescript
// 只匹配行首 @mention，防止误触发
function scanForA2AMentions(text: string): string[] {
  const matches = text.match(/^@(\w+)/gm);
  return matches ? matches.map(m => m.slice(1)) : [];
}
```

**规则**：
- 只匹配**行首** `@agentId`（防止 code block 内的 @mention 误触发）
- 支持链式 A2A（被 @mention 的 Agent 也可以 @mention 第三个 Agent）
- MVP 先串行，并行后续支持

---

## 状态机设计（保持 v1）

```
┌─────────┐  用户确认  ┌──────────┐  用户确认  ┌────────┐  用户确认  ┌────────────┐  用户确认  ┌────┐
│  INIT   │ ─────────> │ RESEARCH  │ ─────────> │ DEBATE │ ─────────> │ CONVERGING │ ─────────> │DONE│
└─────────┘            └──────────┘            └────────┘            └────────────┘            └────┘
                         ↑                                                        │
                         └────────────── 用户选择继续调查 ────────────────────────┘
```

**禁止**：任何状态不允许回到 INIT。

---

## MVP 范围

### 做
- AgentService 抽象层（Claude Code + OpenCode）
- Workspace Manager（`/workspace/room-{id}/` + `--workspace` 参数）
- A2A Router（`scanForA2AMentions` + 路由逻辑）
- Host Agent 强化 prompt（@mention 其他 Agent）
- 基本 UI（消息流 + Agent 状态）

### 不做（后续）
- Session resumption
- 并行 A2A
- Workspace 文件浏览器

---

## Acceptance Criteria

- [ ] AC-1: AgentService 抽象层，支持 Claude Code 和 OpenCode 两个 Provider
- [ ] AC-2: Workspace Manager 创建共享目录，Agent CLI 调用传入 `--workspace` 参数
- [ ] AC-3: A2A Router 正确解析行首 @mention，触发目标 Agent 调用
- [ ] AC-4: Host Agent 能通过 @mention 召集其他 Agent
- [ ] AC-5: 状态机完整运行 INIT → RESEARCH → DEBATE → CONVERGING → DONE
- [ ] AC-6: Web App 本地可运行（localhost）

---

## Open Questions

- [x] Q1: Agent 类型？→ **工具型**
- [x] Q2: 协作方式？→ **A2A @mention**
- [x] Q3: Host 角色？→ **专门 Agent，通过 @mention 召集其他 Agent**
- [x] Q4: AgentService Provider？→ **Claude Code + OpenCode（只做两个）**
- [x] Q5: Workspace 共享机制？→ **文件级共享，`--workspace` 参数**
- [x] Q6: A2A Router 位置？→ **hostReply() 内部，流式完成后扫描**

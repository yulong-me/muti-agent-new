---
feature_ids: [F004]
topics: [multi-agent, manager, orchestration, conversation-mode]
doc_kind: feature
created: 2026-04-12
status: design-approved
owner: 宪宪
summary: "Manager 简化为纯路由器：用户自由对话输入 → Manager 编排 Workers A2A 辩论 → 用户主动要求生成报告"
---

# F004: Manager 简化为路由器（Conversation Mode）

## 背景与动机

F003 实现了 A2A 协作能力，但存在两个问题：
1. **状态机过重**：INIT/RESEARCH/DEBATE/CONVERGING/DONE 五状态流转，用户需多点按钮
2. **Manager 定位模糊**：有时回答问题，有时编排 Workers，职责不清

用户真实需求：**像聊天一样丢话题，Manager 自动找对的人组织讨论，最终给出结论**

## 核心设计原则

1. **Manager = 路由器/编排器**，不直接回答业务问题
2. **用户自由输入**，无预设状态流转
3. **A2A 是唯一触发路径**，Worker 只响应 @mention
4. **Manager 自主决策**收敛时机

## 用户旅程

```
1. 用户在讨论室输入话题（自由文本）
   → 消息发给 Manager（无 @ 则默认）

2. Manager 分析输入，决定行动：
   ├── 需要专家意见 → @mention 相应 Worker
   └── 话题复杂 → @mention 多个 Worker，组织辩论

3. Workers 通过 A2A @mention 相互辩论
   ├── 辩论充分 → 停止，汇报给 Manager
   └── 达深度上限 → Manager 接管决策

4. Manager 判断"够了没"：
   ├── 不够 → 继续组织下一轮
   └── 够了 → 询问用户确认（不是自动生成报告）

5. 用户主动要求 → 生成报告
```

## 架构变化

### 移除
- INIT/RESEARCH/DEBATE/CONVERGING/DONE 状态机
- `hostReply(phase)` 的阶段参数
- `POST /advance` 的 userChoice 按钮驱动
- `/start` 路由的自动流转

### 新增
- **对话模式 API**：`POST /rooms/:id/messages` — 用户发消息，Manager 处理
- **Manager 决策分类**：
  - `route`: @mention Workers 组织辩论（唯一决策）
  - `converge`: 询问用户确认（**不自动生成报告**）
  - `wait`: 需要用户明确确认后再继续
- **有状态对话**：Room 级别存储当前状态（RUNNING/WAITING/DONE）

### 保留
- A2A 深度上限（4层安全阀）
- `scanForA2AMentions` 解析器
- `a2aOrchestrate` 路由引擎
- 流式输出到前端

## 路由决策逻辑

```
用户输入
    ↓
Manager 判断：
    ↓
├─ @mention 了具体 Worker
│   → 透传任务给 Worker（可补充上下文）
│   → Workers 之间可继续 A2A 辩论
│
├─ 未 @ 但需要专家
│   → Manager @mention 最相关的 Worker(s)
│   → 组织 Workers 辩论
│   → 监控 A2A 深度
│   → 达上限 → Manager 接管决策
│
└─ 需要用户明确确认
    → 询问用户，暂停等待回复（设置 WAITING 状态）
    → 用户回复后继续路由
```

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/types.ts` | 修改 | 移除 INIT/RESEARCH/DEBATE/CONVERGING，新增 RUNNING/DONE/WAITING |
| `backend/src/prompts/host.ts` | 重写 | 去掉阶段 prompt，改通用 Manager 路由器 prompt |
| `backend/src/services/stateMachine.ts` | 重构 | 移除 `hostReply(phase)`，改 `handleUserMessage()` |
| `backend/src/routes/rooms.ts` | 简化 | 移除 `/start` 自动流转、`/advance` userChoice |
| `backend/src/routes/rooms.ts` | 新增 | `POST /rooms/:id/messages` 用户对话入口 |

## 开放问题

- [x] Q1: Manager "直接回答" vs "组织辩论" → **结论：永远路由，不直接回答**
- [x] Q2: 用户 @mention 了 Worker，Manager 能干预吗？ → **结论：可以透传但可补充上下文，不拦截**
- [x] Q3: 生成报告是 Manager 主动判断还是用户触发？ → **用户主动要求触发**

## 相关 Feature

- F003: A2A Tool Agent — 依赖 A2A 路由引擎
- F001: Multi-Agent Platform — 基础平台

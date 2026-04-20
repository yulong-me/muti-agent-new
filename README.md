# OpenCouncil

> Open agents. Real debate. Shared decisions.

一个让多个 AI 专家协作辩论并形成共识的工作台。用户创建讨论室、选择专家、把消息明确发给目标专家，专家之间可以继续 `@mention` 其他专家协作。

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![pnpm](https://img.shields.io/badge/pnpm-%3E%3D8-orange)

## 核心能力

- **多专家协作**：一个讨论室可包含 1 位或多位专家（`WORKER`）
- **显式路由**：每条用户消息都明确发给某一位目标专家
- **A2A 协作链**：专家回复过程中可以继续 `@mention` 其他专家参与讨论
- **场景化工作流**：支持 Scenes、Provider、Agent 模型配置、工作目录（Workspace）和报告生成
- **本地持久化**：房间、消息、Provider、Scene、Agent 配置都落在本地 SQLite

## 适用场景

- 让多个 AI 专家围绕一个问题进行讨论、挑战和收敛
- 为代码方案、架构决策、需求拆解提供多视角意见
- 让人物视角型专家围绕同一议题做 roundtable 辩论
- 在同一个房间里保留上下文、工作目录和最终总结

## 系统架构

```text
┌─────────────────────────────────────┐
│           Browser (Next.js)         │  :7002
│  /                房间列表 + 对话     │
│  /room/[id]       专家协作房间        │
│  /settings/*      Agent/Provider/Scene 设置
└────────────┬────────────────────────┘
             │ HTTP REST + Socket.IO
┌────────────▼────────────────────────┐
│           Backend (Express)         │  :7001
│  /api/rooms      房间、消息、报告      │
│  /api/agents     Agent 配置          │
│  /api/providers  Provider 配置       │
│  /api/scenes     Scene 配置          │
│  /api/browse     Workspace 浏览      │
└────────────┬────────────────────────┘
             │ child_process spawn
┌────────────▼────────────────────────┐
│        Local AI CLI Providers       │
│        claude / opencode            │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│   SQLite (backend/data/muti-agent.db)
└─────────────────────────────────────┘
```

## 前置依赖

### 1. Node.js >= 20

```bash
node --version
```

### 2. pnpm >= 8

```bash
pnpm --version
```

### 3. 至少安装一个本地 AI CLI

#### Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

#### OpenCode

参考 [OpenCode 官网](https://opencode.ai) 安装后确认：

```bash
opencode --version
```

## 快速开始

### 克隆仓库

```bash
git clone <your-repo-url>
cd muti-agent-new
```

### 安装依赖

```bash
pnpm install:all
```

### 可选环境变量

后端支持通过 `backend/.env` 调整日志级别：

```bash
LOG_LEVEL=info
```

前端若不走同源代理，可在 `frontend/.env.local` 中指定后端地址：

```bash
NEXT_PUBLIC_API_URL=http://localhost:7001
```

### 启动本地开发环境

```bash
pnpm dev
```

当前默认会同时启动：

| Service | URL |
|---------|-----|
| Backend API | http://localhost:7001 |
| Frontend UI | http://localhost:7002 |

首次启动时会自动创建 SQLite 数据库：

- [backend/data/muti-agent.db](/Users/yulong/work/muti-agent-new/backend/data/muti-agent.db)

### 进入产品

1. 打开 [http://localhost:7002](http://localhost:7002)
2. 进入设置，先配置 Provider
3. 创建房间，选择一个或多个专家
4. 在房间内把消息发给目标专家开始协作

## 配置说明

### Provider

在设置页的 Provider 标签中维护：

- CLI 路径
- API Key
- Base URL
- 默认模型
- 推理开关

### Agent

在设置页的 Agent 标签中维护：

- 角色名和展示标签
- Provider 绑定
- Agent 级模型覆盖
- System Prompt
- 启用状态
- 标签

### Scene

在设置页的 Scene 标签中维护：

- 场景名称与说明
- Prompt 模板
- 内置场景与自定义场景

## 内置人物专家

仓库默认保留一批内置人物视角专家。这些人物 prompt 来源于：

- [.agents/skills](/Users/yulong/work/muti-agent-new/.agents/skills)

如果你希望 fresh DB 启动后仍然自动具备这些人物专家，请不要删除这个目录。

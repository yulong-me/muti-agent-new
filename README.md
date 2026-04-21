# OpenCouncil

> Open agents. Structured debate. Shared context.

一个让多个 AI 专家协作讨论、交叉质疑并逐步收敛观点的工作台。用户创建讨论室、选择专家、把消息明确发给目标专家，专家之间可以继续 `@mention` 其他专家协作。

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-22.x-green)
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

### 1. Node.js 22.x

```bash
node --version
```

仓库根目录提供了 `.nvmrc` / `.node-version`。`dev/build/test` 现在会在启动前显式校验 Node 主版本，不再让不兼容的版本一路运行到半路才报 native / bundler 错误。

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
git clone https://github.com/yulong-me/OpenCouncil.git
cd OpenCouncil
```

### 安装依赖

```bash
pnpm install:all
```

`backend` 使用 `better-sqlite3`。从现在开始，`pnpm dev` / `pnpm --dir backend build` / `pnpm --dir backend test` 会在启动前自动检查并按当前 Node 版本重建 native binding，因此即使开发者切换过 Node 版本，也不会再在运行时才因为 ABI 不匹配崩掉。

### 可选环境变量

后端支持通过 `backend/.env` 调整日志级别：

```bash
LOG_LEVEL=info
```

若前后端不在同一地址，或你需要覆盖默认 API 地址，可在 `frontend/.env.local` 中指定后端地址：

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

- `backend/data/muti-agent.db`

默认运行时目录也都位于 `backend/` 下：

- `backend/data/`
- `backend/logs/`
- `backend/workspaces/`

### 构建

根目录现在提供统一构建入口：

```bash
pnpm build
```

它会顺序执行：

- `pnpm run build:backend`：把后端 TypeScript 编译到 `backend/dist`
- `pnpm run build:frontend`：执行 Next.js 生产构建，产物位于 `frontend/.next`

如果只想单独构建某一侧，也可以直接运行：

```bash
pnpm run build:backend
pnpm run build:frontend
```

### 正式运行

先构建，再用正式启动入口运行：

```bash
pnpm build
pnpm start
```

当前默认会同时启动：

| Service | URL |
|---------|-----|
| Backend API | http://localhost:7001 |
| Frontend UI | http://localhost:7002 |

### 进入产品

1. 打开 [http://localhost:7002](http://localhost:7002)
2. 进入设置，先配置 Provider
3. 创建房间，选择一个或多个专家
4. 在输入框中通过 `@专家名` 或 mention picker 指定接收专家后发送消息

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

- [.agents/skills](./.agents/skills)

如果你希望 fresh DB 启动后仍然自动具备这些人物专家，请不要删除这个目录。

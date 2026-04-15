# AI 智囊团 · Multi-Agent Collaboration Platform

> 基于 CLI 驱动的多智能体协同平台，让多个 AI 专家围绕同一话题自由讨论，并由主持人协调发言。

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![pnpm](https://img.shields.io/badge/pnpm-%3E%3D8-orange)

---

## 目录

- [项目简介](#项目简介)
- [系统架构](#系统架构)
- [前置依赖](#前置依赖)
- [快速开始](#快速开始)
- [配置 AI Provider](#配置-ai-provider)
- [平台兼容说明](#平台兼容说明)
- [目录结构](#目录结构)
- [常见问题](#常见问题)
- [开发指引](#开发指引)

---

## 项目简介

**AI 智囊团**是一个多智能体协同平台：

- 每个讨论室（Room）包含一位**主持人（Manager）** + 多位**专家（Worker）**
- 用户发消息给主持人，主持人负责协调各专家依次发言
- 支持 `@mention` 直接呼唤指定专家
- 消息通过 WebSocket 实时推送，支持思考过程（Thinking）展示
- 所有对话和 Agent 配置持久化存储在本地 SQLite 数据库

---

## 系统架构

```
┌─────────────────────────────────────┐
│           Browser (Next.js)          │  :7002
│  sidebar ─ 会话列表                  │
│  main    ─ 实时对话 + Markdown 渲染  │
└────────────┬────────────────────────┘
             │ HTTP REST + WebSocket (Socket.IO)
┌────────────▼────────────────────────┐
│           Backend (Express)          │  :7001
│  /api/rooms    ─ 会话管理            │
│  /api/agents   ─ Agent 配置          │
│  /api/providers─ LLM Provider 管理   │
│  socket.io     ─ 实时流式推送        │
└────────────┬────────────────────────┘
             │ child_process spawn
┌────────────▼────────────────────────┐
│   AI CLI 工具（本地已安装）           │
│   claude  ─ Claude Code CLI         │
│   opencode─ OpenCode CLI            │
└─────────────────────────────────────┘
             │
┌────────────▼────────────────────────┐
│   SQLite  (backend/data/)           │
│   自动初始化，无需手动建表            │
└─────────────────────────────────────┘
```

---

## 前置依赖

> ⚠️ 请在安装本项目前确认以下工具均已就绪。

### 1. Node.js ≥ 20

```bash
# 验证
node --version   # 需要 v20.x 或更高
```

推荐通过 [nvm](https://github.com/nvm-sh/nvm)（macOS/Linux）或
[nvm-windows](https://github.com/coreybutler/nvm-windows) 安装管理：

```bash
# macOS / Linux
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
```

### 2. pnpm ≥ 8

```bash
# 安装
npm install -g pnpm

# 验证
pnpm --version   # 需要 8.x 或更高
```

### 3. AI CLI 工具（二选一，也可都装）

平台使用 **子进程调用 CLI** 的方式驱动 AI，因此你需要在本机安装至少一个：

#### 选项 A：Claude Code CLI（推荐）

```bash
npm install -g @anthropic-ai/claude-code

# 验证
claude --version
```

> 需要 Anthropic API Key，可通过 UI 在 Provider 设置中填写，也可以通过环境变量 `ANTHROPIC_API_KEY` 注入。

#### 选项 B：OpenCode CLI

参考 [opencode 官方文档](https://opencode.ai) 安装。

```bash
# 验证
opencode --version
```

---

## 快速开始

### 第一步：克隆项目

```bash
git clone https://github.com/your-org/muti-agent.git
cd muti-agent
```

### 第二步：安装依赖

```bash
pnpm install:all
```

这会同时安装 `backend/` 和 `frontend/` 的所有依赖。

### 第三步：创建环境变量文件（可选）

项目开箱即用，但如需调整日志级别，可在根目录和 `backend/` 目录各创建 `.env`：

```bash
# backend/.env
LOG_LEVEL=info   # debug | info | warn | error
```

> `.env` 已被 `.gitignore` 排除，不会提交到代码库。

### 第四步：启动开发服务

```bash
pnpm dev
```

这一条命令会**同时启动**：

| 服务 | 地址 |
|------|------|
| Backend API | http://localhost:7001 |
| Frontend UI | http://localhost:7002 |

首次启动时 SQLite 数据库会**自动创建**于 `backend/data/muti-agent.db`。

### 第五步：打开浏览器

访问 http://localhost:7002，点击右上角 ⚙️ 设置，配置 AI Provider 后即可开始使用。

---

## 配置 AI Provider

平台通过 **UI 界面** 管理全部 AI 设置，无需手动编辑配置文件。

1. 打开 http://localhost:7002
2. 点击顶部导航栏中的 **⚙️（设置）** 图标
3. 选择 **Provider** 标签页
4. 添加 Provider，填写：
   - **CLI 路径**：可执行文件路径（留空则使用系统 PATH 中的 `claude` 或 `opencode`）
   - **API Key**：对应 LLM 服务的密钥（⚠️ 当前以明文存储在 SQLite，生产环境请使用环境变量）
   - **Base URL**：如需代理或私有部署则填写，否则留空使用默认
   - **默认模型**：如 `claude-opus-4-5`
5. 点击 **测试连接** 验证配置是否正确

配置完成后，在 **Agent** 标签页中为每个专家指定所用的 Provider。

---

## 平台兼容说明

### macOS（推荐）

完全支持，以上步骤全部适用。

### Linux

完全支持，步骤与 macOS 相同。

> 若使用非 root 用户且遇到 `EACCES` 权限错误，请检查 npm 全局安装目录配置：
> ```bash
> npm config set prefix ~/.npm-global
> export PATH=~/.npm-global/bin:$PATH
> ```

### Windows

Windows 需要额外注意以下几点：

#### 1. 使用 WSL2（强烈推荐）

在 WSL2（Ubuntu）中运行项目体验等同于 Linux，门槛最低：

```powershell
# PowerShell（管理员）
wsl --install
```

安装完成后在 WSL2 终端中执行上述「快速开始」步骤即可。

#### 2. 原生 Windows（PowerShell / CMD）

如必须在 Windows 原生环境运行：

**a. 安装 pnpm（Windows）**

```powershell
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

**b. `pnpm dev` 中的端口清理脚本**

根目录 `package.json` 中的 `dev` 脚本使用了 Unix 命令（`lsof`、`kill`）。
Windows 原生环境请改用以下命令分两个终端启动：

```powershell
# 终端 1 - 启动 Backend
cd backend
pnpm dev

# 终端 2 - 启动 Frontend
cd frontend
pnpm dev
```

**c. OpenCode 在 Windows 的字符集问题**

项目已内置 UTF-16LE → UTF-8 转换适配，Windows 下使用 opencode CLI 可以正常工作。

---

## 目录结构

```
muti-agent/
├── backend/                 # Express + Socket.IO 后端
│   ├── src/
│   │   ├── routes/          # REST API 路由
│   │   ├── services/
│   │   │   ├── providers/   # claude-code / opencode CLI 适配层
│   │   │   └── stateMachine.ts  # 消息路由 & Agent 调度逻辑
│   │   ├── db/              # SQLite 初始化 & Repository 层
│   │   └── config/          # Agent / Provider 配置接口
│   └── data/                # SQLite 数据文件（自动生成，勿提交）
│
├── frontend/                # Next.js 前端
│   ├── app/
│   │   └── room/[id]/       # 动态路由 — 讨论室页面
│   ├── components/
│   │   ├── RoomListSidebar.tsx   # 会话列表侧边栏
│   │   ├── RoomView_new.tsx      # 主讨论视图
│   │   ├── CreateRoomModal.tsx   # 新建讨论室
│   │   └── SettingsModal.tsx     # 设置面板
│   └── lib/
│       └── agents.ts             # 共享类型 & 工具函数
│
├── docs/                    # 项目文档 & 决策记录
├── package.json             # 根级脚本（一键启动）
└── README.md
```

---

## 常见问题

### Q: 启动后访问 7002 显示空白页

检查 Backend 是否正常启动：

```bash
curl http://localhost:7001/health
# 正常返回: {"status":"ok","timestamp":"..."}
```

若 Backend 未启动，查看终端日志定位错误。

---

### Q: 发送消息后 AI 无响应

1. 确认已在 UI 中**配置并测试**了 Provider（点击「测试连接」按钮出现绿色勾选）
2. 确认 CLI 工具在系统 PATH 中可执行：
   ```bash
   which claude    # 或
   which opencode
   ```
3. 查看 Backend 日志（终端输出，关键字 `provider:call_error`）

---

### Q: `pnpm install:all` 报错 `better-sqlite3` 编译失败

`better-sqlite3` 需要本机 C++ 编译环境：

```bash
# macOS
xcode-select --install

# Linux (Ubuntu/Debian)
sudo apt-get install python3 make g++

# Windows
npm install -g windows-build-tools
# 或安装 Visual Studio Build Tools
```

---

### Q: 端口 7001 或 7002 已被占用

```bash
# macOS / Linux：找出并终止占用进程
lsof -ti:7001 | xargs kill -9
lsof -ti:7002 | xargs kill -9

# Windows PowerShell
netstat -ano | findstr :7001
taskkill /PID <PID> /F
```

---

### Q: Docker 部署支持吗？

目前无官方 Dockerfile，社区贡献欢迎 PR。
注意：容器内需预装 `claude` 或 `opencode` CLI，且 API Key 应通过环境变量注入而非硬编码在配置中。

---

## 开发指引

### 单独启动各服务

```bash
pnpm dev:backend    # 仅启动 Backend（热重载）
pnpm dev:frontend   # 仅启动 Frontend（热重载）
```

### 健康检查端点

```bash
# Backend 健康
GET http://localhost:7001/health

# 调试所有 Room 状态
GET http://localhost:7001/api/debug
```

### 日志级别

```bash
# backend/.env
LOG_LEVEL=debug  # 显示 provider 命令、prompt 摘要等详细信息
LOG_LEVEL=info   # 仅显示请求、响应、关键事件（生产推荐）
```

### 数据库位置

SQLite 文件位于 `backend/data/muti-agent.db`，使用任意 SQLite 客户端（如 DB Browser for SQLite）可直接查看。该目录已被 `.gitignore` 排除。

---

## License

MIT © 2025

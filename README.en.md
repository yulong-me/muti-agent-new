# OpenCouncil

<p align="center">
  <img src="assets/opencouncil-icon-tile-light.svg" alt="OpenCouncil logo" width="112">
</p>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

> Custom agent councils for real work.

OpenCouncil turns "one AI answering alone" into a configurable council of agents. You can create different Scenes for feature review, architecture decisions, market research, code implementation, or any workflow that benefits from multiple roles working in the same room.

Each message can be routed to a specific Agent. Agents can also use `@mention` to challenge, verify, or hand work to each other. The discussion stays in local context and can be connected to the workspace, reports, and implementation work.

The Chinese README is the primary document. This English README is a companion version for international readers and will focus on the product model, architecture, and setup path.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B--25.x-green)
![pnpm](https://img.shields.io/badge/pnpm-10.x-orange)

https://github.com/user-attachments/assets/8ad8797a-482b-48b6-a13d-a17b2d858481

## Core Capabilities

- **Custom Scenes and Agents**: configure task-specific Scenes, expert roles, Providers, models, and workspace paths.
- **Multi-agent rooms**: invite one or more expert Agents into the same room.
- **Explicit routing**: send each message to a specific target expert instead of relying on one hidden prompt.
- **A2A collaboration**: Agents can call each other with `@mention` during a discussion.
- **Workflow-shaped context**: move from a question to critique, plan, report, or implementation.
- **Local persistence**: rooms, messages, Providers, Scenes, and Agent configuration are stored in local SQLite.

## When to Use It

- You want a second opinion before trusting a single-agent answer.
- You want implementation, review, and architecture roles to challenge each other.
- You want repeatable workflows for decisions, product research, or feature planning.
- You want visible multi-agent collaboration without designing a graph workflow first.

## System Architecture

Production mode uses a single public entry point on `7000`. Development mode keeps frontend and backend separate by default:

<p align="center">
  <img src="assets/opencouncil-architecture.svg" alt="OpenCouncil system architecture">
</p>

- `Gateway :7000`: production entry point; routes `/api/*` and `/socket.io/*` to the backend and everything else to the frontend.
- `Frontend :7002`: Next.js UI for room lists, council rooms, and Agent / Provider / Scene settings.
- `Backend :7001`: Express API + Socket.IO for rooms, messages, reports, configuration, workspace browsing, and streaming events.
- `Council Engine`: builds Scene prompts, runs A2A `@mention` routing, and manages Agent run state.
- `Local AI CLI Providers`: invokes Claude Code, OpenCode, or other local CLI providers through `child_process`.
- `Local Data`: stores rooms, messages, Providers, Scenes, and Agent configuration in SQLite; workspace files stay local.

## Requirements

### 1. Node.js 20.19+ / 22.12+ through 25.x

```bash
node --version
```

The repo includes `.nvmrc` and `.node-version`, with Node 22.22.1 as the recommended default. Dev, build, and test commands validate the supported Node range before running, so native dependency issues fail early.

CI covers Node 20.19.x, 22.x, 24.x, and 25.x on Linux, macOS, and Windows. Node 23.x is supported by the local version gate. Node 18 and 21 are not supported by the current backend test stack and `better-sqlite3` native binding.

### 2. pnpm 10.x

```bash
pnpm --version
```

### 3. At least one local AI CLI provider

#### Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

#### OpenCode

Install from the [OpenCode website](https://opencode.ai), then verify:

```bash
opencode --version
```

## Quick Start

### Clone

```bash
git clone https://github.com/yulong-me/OpenCouncil.git
cd OpenCouncil
```

### Install dependencies

```bash
pnpm install:all
```

The backend uses `better-sqlite3`. `pnpm dev`, `pnpm --dir backend build`, and `pnpm --dir backend test` check and rebuild the native binding for the current Node version before running.

### Optional environment variables

Set backend logging in `backend/.env`:

```bash
LOG_LEVEL=info
```

If frontend and backend are not on the default local addresses, set the backend URL in `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:7001
```

You usually do not need this variable:

- `pnpm dev` serves the frontend on `7002` and talks to backend `7001`.
- `pnpm dev:gateway` / `pnpm start` use the same-origin gateway on `7000`.

### Start development mode

```bash
pnpm dev
```

Default development services:

| Service | URL |
|---------|-----|
| Backend API | http://localhost:7001 |
| Frontend UI | http://localhost:7002 |

To simulate the production single-entry gateway locally:

```bash
pnpm dev:gateway
```

| Service | URL |
|---------|-----|
| Gateway | http://localhost:7000 |
| Backend API (internal) | http://localhost:7001 |
| Frontend UI (internal) | http://localhost:7002 |

On first startup, OpenCouncil creates the SQLite database automatically:

- `backend/data/muti-agent.db`

Runtime directories live under `backend/`:

- `backend/data/`
- `backend/logs/`
- `backend/workspaces/`

## Build

```bash
pnpm build
```

This runs:

- `pnpm run build:backend`: compiles backend TypeScript into `backend/dist`.
- `pnpm run build:frontend`: builds the Next.js frontend into `frontend/.next`.

You can also build one side at a time:

```bash
pnpm run build:backend
pnpm run build:frontend
```

## Production Run

Build first, then start the production gateway:

```bash
pnpm build
pnpm start
```

Production mode exposes the gateway on `7000`:

| Service | URL |
|---------|-----|
| Gateway | http://localhost:7000 |
| Backend API (internal) | http://localhost:7001 |
| Frontend UI (internal) | http://localhost:7002 |

If `7000` is already in use:

```bash
GATEWAY_PORT=7100 pnpm start
GATEWAY_PORT=7100 pnpm dev:gateway
```

## Using the Product

Development mode:

1. Open [http://localhost:7002](http://localhost:7002).
2. Go to Settings and configure a Provider.
3. Create a room and select one or more experts.
4. Send messages to a specific expert with `@expert-name` or the mention picker.

Production gateway mode:

1. Open [http://localhost:7000](http://localhost:7000).
2. Go to Settings and configure a Provider.
3. Create a room and select one or more experts.
4. Use `@expert-name` or the mention picker to route each message.

## Configuration

### Provider

Configure Providers in Settings:

- CLI path
- API key
- Base URL
- Default model
- Reasoning / thinking options

### Agent

Configure Agents in Settings:

- Role name and display label
- Bound Provider
- Agent-level model override
- System Prompt
- Enabled state
- Tags

### Scene

Configure Scenes in Settings:

- Scene name and description
- Prompt template
- Built-in and custom Scenes

## Built-in Perspective Experts

The repository keeps a set of built-in perspective experts under:

- [.agents/skills](./.agents/skills)

Do not remove this directory if you want a fresh database to auto-create those built-in experts on first startup.

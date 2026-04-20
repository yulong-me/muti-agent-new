---
feature_ids: [F006]
related_features: [F0043]
topics: [workspace, multi-agent, directory-browser]
doc_kind: spec
created: 2026-04-14
updated: 2026-04-20

## Changelog

- 2026-04-14: 初始版本，包含已实现的后端目录浏览器 API
- 2026-04-20: 修复 workspace / browse 目录访问回归：恢复支持 `~` 外的绝对路径目录，保留 `realpath()` / 绝对路径 / 目录存在性校验
- 2026-04-20: 补齐 workspace 默认目录与 provider cwd 自动化测试，确认 room 级 workspace 会透传到 Claude/OpenCode CLI

## 已完成实现

### 后端 API
- `GET /api/browse` — 目录内容浏览
- `POST /api/browse/mkdir` — 新建文件夹
- `POST /api/browse/pick-directory` — macOS 原生文件夹选择器

### 前端组件
- `DirectoryBrowser.tsx` — web 目录导航弹窗（面包屑 + 列表 + 路径输入 + 新建文件夹）
- `DirectoryPicker.tsx` — 带"浏览"按钮的路径输入框

## Acceptance Criteria

- [x] AC-1: 创建 Room 时点击"浏览"打开目录浏览器弹窗
- [x] AC-2: 目录浏览器可层层导航进入子目录
- [x] AC-3: 面包屑可点击回上级目录
- [x] AC-4: "选择此目录"按钮将当前路径填入并关闭弹窗
- [x] AC-5: POST `/api/pick-directory` 调用系统原生文件夹选择器（macOS osascript）
- [x] AC-6: 留空时使用默认 `workspaces/room-{id}/`
- [x] AC-7: agent CLI cwd 使用 room 绑定的 workspace
- [x] AC-8: 工作目录持久化到数据库，重启后保持
- [x] AC-9: 路径校验失败时显示明确错误
---

# F006: 创建 Room 时可选工作目录

> Status: done | Owner: codex

## Why

当前每个 Room 的工作目录由系统自动生成在 `workspaces/room-{roomId}/`，用户无法指定。对于有明确工作项目的场景（如代码审查、技术调研），用户希望：
- 指定已有的工作目录，agent 直接在该目录下操作
- 避免 agent 在错误的目录下工作
- 支持跨项目协作

参考 **clowder-ai** 的 `DirectoryBrowser` 组件：后端 API 读目录，前端渲染可导航的目录树 + 系统原生文件夹选择器。

## What

### 前端（DirectoryBrowser + DirectoryPicker）

**`frontend/components/DirectoryBrowser.tsx`** — 可导航目录树弹窗（参考 clowder-ai `DirectoryBrowser.tsx`）：

```
┌──────────────────────────────────────────┐
│  选择工作目录                              │
│  Home › Documents › my-project        [+] │
│ ─────────────────────────────────────────│
│  📁 src                                ›│
│  📁 tests                              ›│
│  📁 docs                               ›│
│  📁 .vscode                            ›│
│  📁 node_modules                        │
│ ─────────────────────────────────────────│
│  /Users/yulong/work/my-project          │
│  ┌────────────────────────────────────┐ │
│  │ /Users/yulong/work/...             │ │
│  └────────────────────────────────────┘ │
│                  取消    ✓ 选择此目录    │
└──────────────────────────────────────────┘
```

**功能：**
- 面包屑导航（Home 可点击回根目录）
- 子目录列表，点击进入下一层
- 顶部路径输入框，支持手动跳转
- `[+]` 新建文件夹按钮（POST `/api/browse/mkdir`）
- `[选择此目录]` 确认当前目录
- 关闭按钮 / ESC 取消

**`frontend/components/DirectoryPicker.tsx`** — 触发器组件：

```
┌──────────────────────────────────┐
│ /Users/yulong/work/my-project  [浏览] │
└──────────────────────────────────┘
```

- 点击"浏览"打开 `DirectoryBrowser` 弹窗
- 选择后自动填入路径
- 也可直接手动输入

**`frontend/components/CreateRoomModal.tsx`**：
- 用 `DirectoryPicker` 替换原来的纯文本输入框

### 后端（参考 clowder-ai `projects.ts`）

**`backend/src/routes/browse.ts`** — 目录浏览器 API：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/browse` | GET | 列出目录下子目录，支持 `?path=` 指定路径 |
| `/api/browse/mkdir` | POST | 在指定目录下新建子目录 |
| `/api/pick-directory` | POST | 调用 macOS `osascript` 打开系统原生文件夹选择器 |

**GET /api/browse?path=/Users/yulong/work/my-project**

响应：
```json
{
  "current": "/Users/yulong/work/my-project",
  "name": "my-project",
  "parent": "/Users/yulong/work",
  "homePath": "/Users/yulong/work",
  "entries": [
    { "name": "src", "path": "/Users/yulong/work/my-project/src", "isDirectory": true },
    { "name": "tests", "path": "/Users/yulong/work/my-project/tests", "isDirectory": true }
  ]
}
```

**安全策略（参考 clowder-ai）：**
- 要求绝对路径
- `realpath()` 解析 symlink，拒绝不存在路径
- 仅允许真实存在的目录
- 跳过 `.` 开头的隐藏目录和 `node_modules`

**POST /api/pick-directory**
- macOS：`osascript -e 'POSIX path of (choose folder)'`
- 返回选中的绝对路径
- 校验目录真实存在且当前进程可访问

### 已实现（本次之前）

- [x] `rooms` 表增加 `workspace TEXT` 列
- [x] `POST /api/rooms` 接收 `workspacePath` 参数
- [x] `validateWorkspacePath()` 安全校验
- [x] `ensureWorkspace()` 支持自定义路径
- [x] `room.workspace` 持久化到数据库

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ CreateRoomModal                                        │
│   └─ DirectoryPicker (触发器)                           │
│         └─ DirectoryBrowser (弹窗)                     │
│               └─ GET /api/browse    ← 后端读目录        │
│               └─ POST /api/pick-directory ← 系统原生选择 │
│                                                      │
│  选择后 → workspacePath 填入 → POST /api/rooms        │
│                                       ↓              │
│                              rooms.workspace = 路径     │
│                                       ↓              │
│                              ensureWorkspace(roomId,  │
│                                room.workspace)        │
│                                       ↓              │
│                              Agent CLI cwd = workspace  │
└─────────────────────────────────────────────────────────┘
```

## Acceptance Criteria

- [x] AC-1: 创建 Room 时点击"浏览"打开目录浏览器弹窗
- [x] AC-2: 目录浏览器可层层导航进入子目录
- [x] AC-3: 面包屑可点击回上级目录
- [x] AC-4: "选择此目录"按钮将当前路径填入并关闭弹窗
- [x] AC-5: POST `/api/browse/pick-directory` 调用系统原生文件夹选择器（macOS osascript），前端 DirectoryBrowser 提供"系统选择器"按钮
- [x] AC-6: 留空时使用默认 `workspaces/room-{id}/`
- [x] AC-7: agent CLI cwd 使用 room 绑定的 workspace
- [x] AC-8: 工作目录持久化到数据库，重启后保持（workspace 列已加入 schema + rooms repo）
- [x] AC-9: 路径校验失败时返回明确 HTTP 状态码（404 目录不存在 / 403 越权或无权访问）

> **安全边界统一**：`validateWorkspacePath()`（POST /api/rooms）与 `validatePath()`（/api/browse）统一使用绝对路径 + `realpath()` + 目录存在性校验，允许用户选择 `~` 之外但当前进程可访问的目录。

## Dependencies

- F0043（可观测性日志）：workspace 路径写入 debug 日志

## Risk

- 路径遍历安全：要求绝对路径，且以 `realpath()` 后的真实目录为准
- macOS only：`osascript` 仅 macOS 支持
- 权限问题：agent 用户需对指定目录有读写权限

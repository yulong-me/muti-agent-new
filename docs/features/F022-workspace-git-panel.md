---
feature_ids: [F022]
related_features: [F006]
topics: [workspace, git, file-preview, sidebar]
doc_kind: spec
created: 2026-04-20
updated: 2026-04-20
---

# F022: 工作区文件预览与 Git 面板

> Status: done | Owner: codex

## Why

当前房间右侧仅能粗略列出工作区目录，文件不可预览，也没有任何本地 git 工作流入口。对于代码协作场景，这会导致：

- 需要频繁切出当前应用查看文件内容
- 无法在 room 里直接检查 staged / unstaged 变更
- commit 前缺少统一的 review 入口

目标是把房间侧边栏提升到接近 Codex agent 工具的本地 git 体验：文件浏览、文件预览、diff review、stage / unstage、commit。

## What

### 后端

- `GET /api/browse?includeHidden=1`
  - 工作区文件浏览可显示隐藏文件
  - 永远隐藏 `.git/`
  - 目录排序在文件前
- `GET /api/browse/file?path=...`
  - 文本文件预览
  - 二进制文件识别
  - 大文件截断
- `GET /api/git/status?workspacePath=...`
  - 仓库识别
  - 返回 staged / unstaged / untracked 文件状态
- `GET /api/git/diff?workspacePath=...&filePath=...&staged=1`
  - 文件级 diff
  - 支持 staged review
  - untracked 文件使用 no-index diff
- `POST /api/git/stage`
- `POST /api/git/unstage`
- `POST /api/git/commit`

### 前端

- `WorkspaceSidebar`
  - 右侧工作区模块统一入口
  - `Files` / `Git` 双标签
- `WorkspaceFilesPanel`
  - 多级目录导航
  - 面包屑
  - 点击文件打开预览
- `WorkspaceGitPanel`
  - staged / modified / untracked 三段
  - 单文件 stage / unstage
  - Stage All / Unstage All
  - staged review
  - commit message + commit
- `WorkspacePreviewDialog`
  - 文本文件预览
  - diff 预览

## Acceptance Criteria

- [x] AC-1: 工作区侧栏支持多级目录/文件浏览
- [x] AC-2: 点击文本文件可直接预览
- [x] AC-3: 二进制文件明确提示不可预览
- [x] AC-4: Git 面板显示 staged / modified / untracked
- [x] AC-5: 支持单文件和全部 stage / unstage
- [x] AC-6: 支持查看单文件 diff 与 staged review
- [x] AC-7: 支持填写 commit message 并提交 staged changes
- [x] AC-8: 所有文件与 git 操作仍受 workspace / home 安全边界约束

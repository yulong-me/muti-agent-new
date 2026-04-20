---
feature_ids: [F018]
related_features: [F010, F012, F013, F016]
topics: [mainflow, prompt, room, software-development, ux]
doc_kind: spec
created: 2026-04-19
updated: 2026-04-20
---

# F018: 创建房间后的主流程与提示词体验优化

> Status: done | Owner: codex | Completed: 2026-04-20

## Changelog

- 2026-04-20: 验证 topic 保留、运行时 prompt 上下文、软件开发 scene 默认 prompt 与空房间起手 UX，收口 feature 生命周期

## Why

用户创建房间后，真正的主流程是"明确收件人 → 对话 → 专家协作 → 验证/收敛"。当前系统已经实现了强制 @ 路由和内置场景，但体验有三个断点：

- 创建房间时填写的 topic 没有进入后端 Room，房间上下文被弱化。
- 空房间和未 @ 发送时，只隐式打开 mention picker，用户不知道为什么不能发。
- 软件开发场景提示词偏 review 门禁，没有把"先理解需求、再规划、TDD/验证、证据、协作出口"变成主流程协议。

## Prompt Hierarchy Scan

### 当前项目

1. Repo 治理层：`AGENTS.md` / `CLAUDE.md` 约束当前编码 agent，不一定进入运行时专家。
2. Agent 身份层：`.agents/skills/*-perspective/SKILL.md` 作为 `systemPrompt` seed 到 DB。
3. Scene 场景层：`scenes.prompt` 注入每次专家执行，受 seed-once 保护。
4. Action 基础层：`stateMachine.ts` 构造当前执行者、角色和用户任务。
5. Runtime 上下文层：`scenePromptBuilder.ts` 注入工作目录、议题、任务、调用链、对话记录。
6. Provider 执行层：Claude Code / OpenCode 等 provider wrapper。

### clowder-ai

1. 静态身份层：身份、A2A 协作格式、队友名单、治理摘要。
2. Invocation Context：每次调用注入当前接收人、发起人、队友、模式、路由策略和工作流提示。
3. Mode/Guide 层：把场景引导和工作流触发从通用 system prompt 里拆出来。
4. Context Assembly：按 token 预算拼接历史、长期记忆和当前任务，避免无边界堆上下文。

### 可借鉴点

- 每次调用必须有"当前接收人"和"参与专家名单"，让模型知道自己是谁、队友是谁、何时 @。
- 场景提示词只放稳定协议，运行时上下文放动态事实。
- 软件开发场景应把工作流门禁写成顺序协议，而不是只写 review 态度。
- UX 层要把强制 @ 路由显性化，避免用户以为发送按钮坏了。

## What

- 创建房间保留用户 topic，并继续兼容空 topic 的默认值。
- 空房间给出明确起手建议和专家快捷 @。
- 没有 @ 发送时显示错误提示，同时打开 mention picker。
- 软件开发内置场景强化为"理解需求 → 实施计划 → TDD/验证 → review/合入门禁 → 协作出口检查"。
- `scenePromptBuilder` 注入当前接收人和参与专家列表。
- 内置场景默认值只影响新 seed，不覆盖已有用户编辑过的 builtin scene。

## Acceptance Criteria

- [x] AC-1: `POST /api/rooms` 使用用户提供的 trimmed topic。
- [x] AC-2: 运行时 prompt 包含 `【当前接收人】` 和 `【参与专家】`。
- [x] AC-3: 软件开发 scene 默认 prompt 包含理解需求、实施计划、TDD、review、测试证据。
- [x] AC-4: 空房间提示用户必须 @ 专家，并提供专家快捷按钮。
- [x] AC-5: 未 @ 发送时给出可见错误提示，不只打开 picker。
- [x] AC-6: seed-once 机制不变，不自动覆盖已有 DB 数据。

## Implementation Notes

- 内置 scene prompt 从 `migrate.ts` 抽到 `backend/src/prompts/builtinScenes.ts`，迁移层只负责 seed。
- `ensureBuiltinScenes()` 仍使用 `INSERT ... WHERE NOT EXISTS`。
- 软件开发 prompt 借鉴 clowder-ai 的 invocation anchor 思路，但不引入复杂 guide / queue 系统。

## Verification

- `pnpm --dir backend exec vitest run tests/rooms.http.test.ts tests/scenes.test.ts tests/builtinScenes.test.ts`
- `pnpm --dir frontend build`

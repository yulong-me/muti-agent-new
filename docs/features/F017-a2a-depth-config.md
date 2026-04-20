---
feature_ids: [F017]
related_features: [F004, F0042]
topics: [a2a, routing, depth, configurable]
doc_kind: spec
created: 2026-04-17
---

# F017: A2A 协作深度可配置化

> Status: done | Owner: codex

## Why

当前 `MAX_A2A_DEPTH = 4` 硬编码在 `A2ARouter.ts` 里，所有房间统一使用，无法根据场景调整：
- 简单讨论（2-3人）：3层足够，过深容易跑题
- 深度辩论/复杂分析：10层+ 才能充分展开
- 无限制：某些复杂议题需要自由展开

用户需要按场景灵活调整，而不是"所有房间一个深度"。

## What

Room 级别可配置的 A2A 最大协作深度，通过房间顶栏快捷切换器操作。

当前架构没有主持人；深度命中时由系统直接提示用户“已达到协作深度上限”，并停止继续 @ 新专家。

## Design

### 档位定义

| 档位 | 值 | 说明 |
|------|---|------|
| 浅 | 3 | 适合简单讨论，避免跑题 |
| 中 | 5 | 默认，适合大部分场景 |
| 深 | 10 | 适合复杂议题深度辩论 |
| 无限 | 0 | 无深度限制，自由展开 |

### 前端 UI

**位置**：房间顶栏，状态标签旁边

**样式**：紧凑的 Segmented Control / Chip Toggle / 下拉菜单
- 当前深度高亮显示
- Hover 显示中文标签
- 点击即切换，实时生效
- 若此前设置过 room override，支持切回「跟随场景」恢复 scene 默认值

**示例**：
```
[状态: 讨论中]  [浅] [中●] [深] [∞]
```

### 后端数据流

```
┌─────────────────────────────────────────────────┐
│  SceneConfig.maxA2ADepth (默认)                    │
│  ├── roundtable-forum: 5                          │
│  └── software-development: 5                      │
├─────────────────────────────────────────────────┤
│  DiscussionRoom.maxA2ADepth (room 覆盖)            │
│  ├── null → 继承 scene 默认                       │
│  ├── 3/5/10/0 → room 覆盖                        │
│  └── 存于 rooms.max_a2a_depth 列                  │
└─────────────────────────────────────────────────┘
```

### 路由逻辑

```
effectiveDepth = room.maxA2ADepth ?? scene.maxA2ADepth ?? 5
if (depth >= effectiveDepth) → 截断
```

### API

**PATCH /api/rooms/:id**
```json
{ "maxA2ADepth": 3 | 5 | 10 | 0 }
```

**GET /api/rooms/:id/messages** 返回
```json
{
  "agents": [...],
  "maxA2ADepth": 5  // 当前生效的深度
}
```

## Implementation

### DB Schema
- `rooms.max_a2a_depth INTEGER` (nullable, null=继承scene)
- 迁移：新增列（nullable，不破坏现有数据）

### Backend
- `DiscussionRoom` interface + `maxA2ADepth`
- `SceneConfig` interface + `maxA2ADepth` (seed 默认值)
- `A2ARouter.ts`: 读取 `room.maxA2ADepth ?? scene.maxA2ADepth ?? 5`
- `stateMachine.ts`: 同上
- `rooms.ts`: PATCH 支持 maxA2ADepth 字段
- 提示词：动态注入当前深度值（当前层数 + 生效上限）

### Frontend
- `RoomView_new.tsx`: 顶栏添加深度切换控件
- 切换时 PATCH room，然后触发 UI 更新
- 当前深度 + 已用深度进度条（可选）

## Acceptance Criteria

- [x] AC-1: 房间顶栏显示当前深度（默认"中 (5)"）
- [x] AC-2: 点击切换即时生效，后续 A2A 路由使用新深度
- [x] AC-3: 深度到达上限时，agent 停止 @提及新专家，并提示"已达到协作深度上限"
- [x] AC-4: 历史消息不重新计算（不回朔）
- [x] AC-5: 无限制模式（∞）取消深度检查
- [x] AC-6: null 继承 scene 默认值（向后兼容）

---

## 附录：已知问题（暂不修复）

### 输入框卡顿问题（2026-04-17 发现）

**症状**：在输入框打字时感到明显卡顿，IME（拼音输入法）场景下尤为严重。

**根因链**：

每次按键触发最多 5 次 `setState` → 连锁 re-render：

```
用户按一个键
  → setUserInput()                      [1次 re-render]
  → findActiveMentionTrigger()
    → agents.map(a => a.name)            [每次重建数组]
    → 正则匹配
    → openMentionPicker() / closeMentionPicker()
      → setMentionPickerOpen()           [+1次 re-render]
      → setMentionQuery()                [+1次 re-render]
      → setMentionStartIdx()             [+1次 re-render]
      → setMentionHighlightIdx()         [+1次 re-render]
```

IME 输入时，每个拼音音节都会触发 `onChange` → 疯狂抖动。

**瓶颈定位**：

| 严重度 | 位置 | 问题 |
|--------|------|------|
| 高 | IME 组合输入 | 每个音节触发一次 `onChange` → 连锁反应 |
| 高 | MentionPicker 开关 | 每键最多 4 次 `setState` |
| 中 | `handleInputChange` | `agents.map()` 每键重建 |
| 中 | `filteredAgents` useMemo | `mentionQuery` 每变一次就重算 |
| 低 | textarea CSS | `transition-all` 每次 re-render 重新计算 |

**建议修复方案**（待实施）：

1. 对 `findActiveMentionTrigger` + `open/closeMentionPicker` 加 **150ms debounce**，IME 场景只在组合完成（commit）时触发
2. `agents.map(a => a.name)` → `useMemo` 稳定引用
3. MentionPicker 只在 `query.length >= 1` 时才打开，减少空查询抖动
4. 去掉 textarea 的 `transition-all`

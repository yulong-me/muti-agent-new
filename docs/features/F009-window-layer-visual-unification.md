---
feature_ids: [F009]
related_features: [F008, F006, F007]
topics: [UX, frontend, dialogs, drawers, visual-consistency, islands]
doc_kind: spec
created: 2026-04-16
---

# F009: Window Layer Visual Unification

> Status: done | Owner: TBD

## Why

当前主讨论界面已经切换到统一的 `app-islands` / restrained glass 视觉语言，但系统中的多个窗口级浮层仍保留旧的后台式卡片风格。结果是：

- 用户在主界面与弹窗/抽屉之间切换时，会明显感知到“进入了另一套产品皮肤”。
- 设置面板、创建讨论、邀请专家、目录浏览器、移动端抽屉与主界面之间存在材质、边界、层级和交互反馈断层。
- 即使局部组件已经统一，如果窗口级壳层和内部 header/body/footer 结构没有统一，整体体验仍然碎裂。

这不是纯样式 polish，而是窗口层信息架构和视觉一致性问题。应独立立项，避免持续被零散修补。

## What

为系统所有窗口级浮层建立统一的视觉语言和结构规则，使它们都成为主讨论界面的同系统延伸。

### Window / Overlay Inventory

以下浮层全部纳入 F009 范围，不能只改其中一部分：

1. `SettingsModal`
   - 文件：`frontend/components/SettingsModal.tsx`
   - 类型：右侧主设置抽屉

2. `ConfirmDeleteDialog`
   - 文件：`frontend/components/SettingsModal.tsx`
   - 类型：确认删除弹窗

3. `CreateRoomModal`
   - 文件：`frontend/components/CreateRoomModal.tsx`
   - 类型：创建讨论弹窗

4. `AgentInviteDrawer`
   - 文件：`frontend/components/AgentInviteDrawer.tsx`
   - 类型：邀请专家弹窗

5. `DirectoryBrowser`
   - 文件：`frontend/components/DirectoryBrowser.tsx`
   - 类型：目录浏览器弹窗

6. Mobile Agent Drawer
   - 文件：`frontend/components/RoomView_new.tsx`
   - 类型：移动端 Agent 抽屉

7. Mobile Room Menu
   - 文件：`frontend/components/RoomListSidebar.tsx`
   - 类型：移动端讨论列表菜单 / 抽屉

8. `MentionPicker`
   - 文件：`frontend/components/MentionPicker.tsx`
   - 类型：输入区上方的浮动选择面板 / popover

> 说明：`MentionPicker` 虽然不是全屏 dialog，但它属于明显的浮层式交互容器，也必须接入同一窗口语言；否则主界面统一后，局部 popup 仍会显得像旧系统残留。

### In Scope

- 设置抽屉外壳、header、内部卡片层级、表单控件状态统一
- 设置删除确认弹窗统一
- 新讨论弹窗的窗口壳层与内部结构统一
- 邀请专家弹窗的窗口壳层与内部结构统一
- 目录浏览器弹窗的窗口壳层与内部结构统一
- mobile agent drawer 统一
- mobile 房间侧边栏菜单统一
- mention picker / popup panel 统一
- 全局 `app-islands` 样式补充窗口层辅助类，但不新建第二套主题

### Out of Scope

- 主聊天流程的信息架构重构
- 收件人显式化、标题命名、思考过程折叠、邀请流程反馈等交互逻辑修改
- 纯业务逻辑、接口契约、状态机相关改动

## Acceptance Criteria

- [x] AC-1: `SettingsModal` 外壳与主界面 `app-islands-panel` 属于同一材质系统，不再保留旧版后台抽屉感。
- [x] AC-2: `CreateRoomModal`、`AgentInviteDrawer`、`DirectoryBrowser`、`ConfirmDeleteDialog`、mobile agent drawer、mobile room menu 全部接入统一的窗口级视觉语言。
- [x] AC-2.1: `SettingsDrawer` 若仍保留在代码中，必须与 `SettingsModal` 共享同一窗口主题语言，不能保留旧版抽屉皮肤。（注：`SettingsDrawer` 为废弃代码，未被任何模块引用，无需处理）
- [x] AC-2.2: `MentionPicker` 必须与主窗口体系保持一致，不再像独立旧版 popup。
- [x] AC-3: 所有窗口级浮层的遮罩层、边框、圆角、阴影、透明度与 blur 强度处于同一体系。
- [x] AC-4: 所有窗口内部的 `header / body / footer` 分层结构统一，不再出现”外壳像 islands，内容像旧面板”的混搭。
- [x] AC-5: 设置面板中的内容卡片、表格容器、provider 列表项、确认删除弹窗等，不再混用 glass 与旧版 dashboard 卡片语言。
- [x] AC-6: 设置面板中的 `input / textarea / select / 主按钮 / 次按钮 / 危险按钮 / hover / focus` 状态与主界面属于同一视觉家族。
- [x] AC-7: `frontend/app/globals.css` 仅在 `app-islands` 体系上扩展窗口层辅助类，不引入与 `app-islands-*` 平行的第二套 settings/dialog theme。已实现 `app-window-shell`（完整 islands-panel 渐变/inner-shadow/backdrop-filter/pseudo-elements 变体）和 `app-window-surface`（内部卡片表面层），三个浮层均接入共享类。
- [x] AC-8: 从用户视角看，主界面与所有主要浮层属于同一产品系统，不再出现明显”换皮”感。

## Dependencies

- 依赖现有 `app-islands` 视觉体系作为唯一基础来源
- 依赖 `RoomView_new.tsx`、`RoomListSidebar.tsx`、`AgentPanel.tsx` 作为视觉参考基线
- 与 F008 的 UX 骨架优化相关，但可独立实施和验收

## Risk

- 如果只统一外壳、不统一内部 header/body/footer，最终会形成“半套主题”。
- 如果为设置页或弹窗单独创建一套 token，会再次造成风格分叉。
- 如果过度强调 glass 效果，会与当前更克制的 Linear / Arc 方向冲突。
- 多个窗口共用辅助类时，若命名和分层不清晰，后续维护会失控。

## Open Questions

- 是否需要定义专门的窗口层辅助类（如 `app-islands-dialog`, `app-islands-drawer`, `app-islands-overlay`），还是完全依赖现有 `app-islands-panel` 组合？
- 删除确认弹窗是否应完全复用一般 dialog 壳层，还是保留更强的危险态强调？
- mobile room menu 是否应与桌面侧边栏完全同质，还是保留更轻的抽屉化表达？

## Proposed File Scope

- `frontend/components/SettingsModal.tsx`
- `frontend/components/CreateRoomModal.tsx`
- `frontend/components/AgentInviteDrawer.tsx`
- `frontend/components/DirectoryBrowser.tsx`
- `frontend/components/MentionPicker.tsx`
- `frontend/components/RoomView_new.tsx`
- `frontend/components/RoomListSidebar.tsx`
- `frontend/app/globals.css`

## Reviewer Checklist

- [x] 主界面与窗口级浮层之间不再存在明显材质断层。
- [x] 设置抽屉、创建讨论、邀请专家、目录浏览器、确认删除、移动端抽屉/菜单、mention picker 全部统一。（旧版 SettingsDrawer 已删除，不纳入范围）
- [x] 窗口内部 header、body、footer 结构连续，视觉上属于同一系统。
- [x] 输入框、按钮、hover/focus 状态没有沿用旧版后台控件风格。
- [x] 没有引入第二套 dialog/settings 主题系统。

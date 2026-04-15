---
feature_ids: [F008]
related_features: []
topics: [UX, Frontend, CSS]
doc_kind: plan
created: 2026-04-15
---

# F008: UX Skeleton Improvements Implementation Plan

**Feature:** F008 — `docs/features/F008-ux-skeleton-improvements.md`
**Goal:** 修复当前系统的核心输入、空间布局、阅读心流和架构信息等骨架级 UX 问题，提升大屏阅读体验与小屏可用性。
**Acceptance Criteria:** 
- [ ] AC-1: 底部输入框实现自动高度适应（Auto-resize），并具有最大高度限制和内部滚动条。
- [ ] AC-2: 优化 `MentionQueue` 渲染位置（移至输入框内部或重构绝对定位），消除输入区的视觉跳动。
- [ ] AC-3: 扩展大屏下消息气泡的最大宽度限制，防止大段代码过早折行。
- [ ] AC-4: 小屏幕设备下，Agent 面板不应直接隐藏，可通过 Drawer 或菜单调出。
- [ ] AC-5: 剥离 `AgentPanel` 底部原生的 Debug 日志，将其转移至独立的设置或单独的控制台入口，降低认知负担。
- [ ] AC-6: 确保大模型“思考过程” (Thinking) 默认折叠，以避免干扰阅读心流（仅在流式生成或明确点击时展开）。
**Architecture:** 
- 采用 React 现有的组件组合，针对 `RoomView_new.tsx` 中的 `<textarea>` 替换为支持自动增长尺寸的组件或手写原生 JS 计算。
- 重构 `AgentPanel` 为响应式：大屏侧边栏，小屏 Drawer（复用现有的 Drawer 模式）。
- 重置气泡宽度（如 `md:max-w-[85%] lg:max-w-[90%]`）。
**Tech Stack:** React, TailwindCSS, lucide-react
**前端验证:** Yes

---

### Task 1: 底部输入框自适应高度与 Mention 队列优化

**Files:**
- Modify: `frontend/components/RoomView_new.tsx`

**Step 1: 引入自动增长逻辑**
- 在 `RoomView_new.tsx` 中为 `textarea` 添加输入事件处理，动态调整 `height` 样式，设置 `max-height` 限制。
- 将 `MentionQueue` 的位置重构为绝对定位或在弹性容器内不挤压 `textarea` 高度。

### Task 2: 消息气泡宽度扩容

**Files:**
- Modify: `frontend/components/BubbleSection.tsx`

**Step 1: 修改气泡最大宽度**
- 查找 `max-w-[75%]` 等写死的类名，更新为 `max-w-[85%] xl:max-w-[90%]` 以提升宽屏下的代码块可读性。
- 确认 Thinking 折叠逻辑（`isExpanded`）符合 AC-6 预期。

### Task 3: 剥离 Debug 日志与优化 Agent 面板

**Files:**
- Modify: `frontend/components/AgentPanel.tsx`
- Modify: `frontend/components/SettingsModal.tsx` (or similar)
- Modify: `frontend/components/RoomView_new.tsx`

**Step 1: 迁移 Debug 日志**
- 从 `AgentPanel.tsx` 移除 `debugLogs` 相关的渲染区域。
- 如果需要保留，可通过顶部的统一配置栏或独立的 `Debug Drawer` 组件触发。

**Step 2: 增加小屏适配 Drawer**
- 修改 `AgentPanel` 外部容器，在 `lg` 以下断点提供一个汉堡菜单按钮来打开装载 `AgentPanel` 的 Drawer，防止移动端丢失上下文信息。

---

## High-Priority UX Fix Brief for ARD Agent

> 用途：本节是给执行修改的 ARD Agent 的详细交接说明。实现方按本节修改；验收由其他 Agent 负责。

### What

本轮必须处理 5 个高优先级 UX 问题：

1. 输入区收件人不显式，发送目标依赖隐式规则。
2. 新讨论标题不可命名，历史记录不可扫描。
3. 思考过程抢占主阅读焦点。
4. Debug 日志污染主界面信息架构。
5. 邀请专家成功后过快自动关闭，反馈不可确认。

### Why

- 这 5 个问题都发生在主路径：发消息、读回复、管理讨论、邀请专家。
- 它们共同暴露的是同一个系统性问题：当前 UI 让“系统内部状态”优先于“用户当前任务”。
- 如果不先处理这 5 项，后续再做视觉优化或样式统一，收益会很有限。

### Tradeoff

允许的代价：

- 主界面会增加少量显式控制，例如收件人选择器、讨论标题输入框。
- 某些“自动化”行为会减少，换来更高的可预测性和可控性。
- Debug 入口会后移，开发调试会多一步。

不接受的代价：

- 继续依赖隐式规则（尤其是发送对象）。
- 只改文案，不改交互结构。
- 用更多视觉元素掩盖信息架构问题。

### Open Questions

若实现时遇到这些问题，默认采用推荐方案，不要阻塞：

- 是否支持“发送给全体”？
  - 默认答案：先不做；仅支持“主持人 / 单个专家”。
- 讨论标题是否允许后续编辑？
  - 默认答案：本轮不做编辑，只解决创建时命名。
- 思考过程是否完全隐藏？
  - 默认答案：不隐藏，默认折叠。
- Debug 放哪里？
  - 默认答案：从主讨论界面移出；优先放设置页或开发模式入口。

### Next Action

按下面 5 个问题说明直接修改相关文件。实现完成后，由验收方按文末验收标准逐条检查。

---

## Issue 1: 输入区收件人不显式

**Location**

- `frontend/components/RoomView_new.tsx`

**Problem**

- 当前发送逻辑默认发给主持人，只有 `@mention` 时才覆盖收件人。
- 这是内部规则，不是界面规则。用户在点击发送前，无法稳定确认“这条消息到底发给谁”。
- 结果是：高频使用时容易误发；低频使用时必须靠记忆学习系统规则。

**Recommended Change**

- 在输入区增加显式的收件人选择器。
- 默认值显示为“主持人”。
- `@mention` 只作为快捷操作，不再是唯一的目标切换方式。
- 当 `@mention` 覆盖当前收件人时，输入区要同步显示当前目标，例如：
  - `当前发送给：诸葛亮`
- 发送按钮附近保留接收者 chip 或 pill，确保发送前可见。

**Recommended UX Shape**

- 输入框上方或左侧：`发送给 [主持人 v]`
- 若用户输入 `@诸葛亮`，界面同步改成：`发送给 [诸葛亮 v]`
- 若收件人被切换，应在发送前始终可见，不依赖 placeholder 或 tooltip

**Do Not**

- 不要继续仅通过 `@mention` 隐式决定收件人。
- 不要把收件人信息只藏在日志、埋点或 hover 提示里。

**Acceptance**

- 用户不输入任何字符时，也能看到当前收件人。
- 用户切换收件人后，UI 立即反馈。
- 输入 `@某专家` 后，UI 展示的收件人与实际发送对象一致。
- 不存在“界面显示 A，实际发给 B”的情况。

---

## Issue 2: 新讨论标题不可命名

**Location**

- `frontend/components/CreateRoomModal.tsx`
- `frontend/components/RoomListSidebar.tsx`

**Problem**

- 当前 `topic` 被固定为“自由讨论”。
- 这会直接破坏讨论历史的可扫描性。房间一多，侧边栏几乎不可用。
- 这个问题不是文案问题，而是导航信息结构缺失。

**Recommended Change**

- 在创建讨论弹窗中增加“讨论主题”输入框。
- 用户可在创建前输入标题。
- 若用户不填，才走兜底策略，例如：
  - `未命名讨论 14:32`
  - 或首条消息摘要
- 不允许所有讨论默认都叫“自由讨论”。

**Recommended UX Shape**

- 在主持人选择区之前或之后放置一个标题输入框：
  - Label：`讨论主题`
  - Placeholder：`例如：比较 Claude Code 和 OpenCode 的协作策略…`

**Do Not**

- 不要继续写死统一标题。
- 不要让标题在创建后异步慢慢补出来，导致列表先出现一堆重复项。

**Acceptance**

- 创建讨论时可以输入标题。
- 标题在讨论创建后立即出现在左侧列表中。
- 连续创建多个讨论时，用户可仅凭标题完成区分。
- 未输入标题时，不再出现一排“自由讨论”。

---

## Issue 3: 思考过程抢占主阅读焦点

**Location**

- `frontend/components/BubbleSection.tsx`
- `frontend/components/RoomView_new.tsx`

**Problem**

- 当前 `思考过程` 在流式阶段会被强制展开。
- 用户在阅读回复时，会被大量中间推理文本打断，最终答案的优先级不够高。
- 对普通用户来说，思考过程不是主任务信息，而是次级、可选、甚至偏调试的信息。

**Recommended Change**

- 回复内容始终保持默认展开。
- 思考过程默认折叠。
- 流式期间不再强制展开思考过程。
- 思考过程仅显示一条轻量提示，例如：
  - `思考中…点击展开查看`
- 给思考过程加上降权语义，例如：
  - `中间过程`
  - `调试信息`

**Recommended UX Shape**

- 回复卡片结构：
  - 一级：回复正文
  - 二级：折叠的思考过程
- 用户展开思考后，可保留展开状态，但不能抢占主内容首屏。

**Do Not**

- 不要直接删除思考过程能力。
- 不要在流式返回时再次自动撑开大段思考文本。

**Acceptance**

- 新回复出现时，用户首屏先看到回复正文。
- 不展开思考过程时，消息卡显著更紧凑。
- 连续多条回复不会造成“思考文本刷屏”。
- 用户仍能主动展开查看中间过程。

---

## Issue 4: Debug 日志污染主界面

**Location**

- `frontend/components/AgentPanel.tsx`
- `frontend/components/RoomView_new.tsx`
- 如有必要：`frontend/components/SettingsModal.tsx`

**Problem**

- Debug 日志当前与“参与 Agent”同处主讨论界面。
- 这会误导用户，让系统实现细节与产品核心信息并列。
- 结果是主界面像开发工具，而不是多 Agent 协作产品。

**Recommended Change**

- 将 Debug 日志从主讨论侧边栏移除。
- 迁移到以下任一位置：
  - 设置页中的“开发者 / 诊断”区域
  - 仅在开发模式下可见的调试面板
- 主页面只展示与讨论直接相关的信息。

**Recommended UX Shape**

- 普通模式：
  - 右侧仅保留参与 Agent、状态、轻量上下文信息
- 开发者模式：
  - 额外出现日志入口或单独 Drawer

**Do Not**

- 不要只是把 debug 区折叠一下但仍长期占位。
- 不要继续让日志区域与核心讨论信息同权。

**Acceptance**

- 普通用户默认看不到 debug 日志。
- 主讨论页面右侧不再被系统事件流占据。
- 如果开启开发者模式，仍可访问日志，但不会干扰普通路径。

---

## Issue 5: 邀请专家成功后过快自动关闭

**Location**

- `frontend/components/AgentInviteDrawer.tsx`

**Problem**

- 当前邀请成功后 `250ms` 自动关闭。
- 用户来不及确认结果，也无法连续邀请多个专家。
- 这个流程的任务闭环不完整：操作已完成，但用户没有完成感。

**Recommended Change**

- 删除自动关闭逻辑。
- 邀请成功后：
  - 当前条目按钮变为 `已邀请`
  - 当前条目禁用或进入已邀请状态
  - 用户可继续邀请其他专家
- 弹窗由用户主动关闭。
- 若实现成本低，可补一个轻量 success 提示。

**Recommended UX Shape**

- 列表项状态变化：
  - `邀请` → `邀请中…` → `已邀请`
- 成功后列表保留，用户可以继续操作，而不是被弹窗打断。

**Do Not**

- 不要继续在成功后立即自动关闭。
- 不要只依赖瞬时文案变化表达成功。

**Acceptance**

- 邀请成功后，用户可以明确看见成功状态。
- 用户可以在同一弹窗里连续邀请多个专家。
- 失败提示会停留足够久，并允许继续操作。
- 已邀请项不会再被误点或误邀请。

---

## Suggested File Scope

- `frontend/components/RoomView_new.tsx`
- `frontend/components/BubbleSection.tsx`
- `frontend/components/CreateRoomModal.tsx`
- `frontend/components/AgentInviteDrawer.tsx`
- `frontend/components/AgentPanel.tsx`

可选关联文件：

- `frontend/components/RoomListSidebar.tsx`
- `frontend/components/SettingsModal.tsx`
- `frontend/lib/agents.tsx`

---

## Final Acceptance Checklist for Reviewer

- [ ] 发送前，当前收件人始终可见且与实际发送行为一致。
- [ ] 新讨论创建时支持命名；历史列表不再被“自由讨论”淹没。
- [ ] 回复正文优先级高于思考过程；思考过程默认折叠。
- [ ] 主讨论界面默认不展示 Debug 日志。
- [ ] 邀请专家成功后不会自动关闭，且可连续邀请多个专家。
- [ ] 设置面板与主讨论界面使用统一的视觉语言，不再出现明显的风格断层。

---

## Additional UI Consistency Issue: 设置面板风格未统一

**Location**

- `frontend/components/SettingsModal.tsx`
- 如有必要：`frontend/components/SettingsDrawer.tsx`
- 对照基准：`frontend/components/RoomView_new.tsx`, `frontend/app/globals.css`

**Problem**

- 主讨论界面已经切换到统一的 islands / restrained glass 风格。
- 设置面板仍大量使用旧的 `bg-bg`, `bg-surface`, `border-line`, `rounded-2xl` 组合，没有接入同一套 panel shell、surface 层级和交互细节。
- 结果是用户从主讨论区打开设置时，会感知到明显的“像进入了另一个产品”。

**Recommended Change**

- 设置面板整体纳入同一套 `app-islands` 视觉系统。
- 至少统一以下层级：
  - 外层容器的 panel 壳层
  - 顶部 header 的背景与分隔方式
  - 卡片、表格、表单输入框、按钮的 surface 透明度与边框强度
  - hover / focus / active 的反馈强度
- 保持设置页的信息架构不变，但视觉语言必须与主界面连续。

**Recommended UX Shape**

- 设置抽屉应像“主界面的一个延伸面板”，而不是另起一套后台管理皮肤。
- 用户从聊天页进入设置页时，视觉上应保留：
  - 同类的 panel 轮廓
  - 同类的表面透明度
  - 同类的边界与高光节制

**Do Not**

- 不要只改几个圆角或背景色。
- 不要让设置页继续保留明显更实、更厚、更偏旧版卡片 UI 的风格。
- 不要让主界面是 restrained glass，而设置面板像传统 dashboard。

**Acceptance**

- 打开设置面板时，视觉上与主讨论界面属于同一套系统。
- 设置 header、内容卡片、列表、表单输入在材质、边框、圆角、状态反馈上保持一致。
- 用户不会明显感知“进入了另一套产品皮肤”。

---

## Standalone Implementation Task: 设置面板风格统一

### Goal

让设置面板成为主讨论界面的同一视觉系统延伸，而不是独立的后台样式页。

### Scope

**Primary Files**

- `frontend/components/SettingsModal.tsx`

**Secondary Files**

- `frontend/components/SettingsDrawer.tsx`
- `frontend/app/globals.css`

**Visual Reference**

- `frontend/components/RoomView_new.tsx`
- `frontend/components/RoomListSidebar.tsx`
- `frontend/components/AgentPanel.tsx`

### Required Implementation

#### Task A: 设置抽屉外壳接入 islands panel shell

**Target**

- `frontend/components/SettingsModal.tsx`

**What to change**

- 将设置抽屉最外层容器从旧的纯色背景容器，统一为与主界面一致的 panel shell。
- 要对齐的维度：
  - 外层壳体材质
  - 边框透明度
  - 阴影深度
  - 圆角语言
  - 内容裁切行为

**Recommended approach**

- 复用现有 `app-islands-panel` 语义，不要重新发明新的 setting-panel 体系。
- 如抽屉宽度和布局特殊，可在 `SettingsModal.tsx` 上叠加一个 settings-specific class，但基础壳体必须继承 islands shell。

**Acceptance**

- 设置抽屉整体看起来像右侧延展出的同系统面板。
- 抽屉开合后，不会出现一眼可见的背景材质断层。

#### Task B: 设置 Header 与主界面 Header 对齐

**Target**

- `frontend/components/SettingsModal.tsx`

**What to change**

- 设置 Header 的背景、分隔线、tab 容器、关闭按钮，需要与主界面顶部工具栏保持同一风格等级。
- 当前 header 仍偏传统管理面板，需要压回 restrained glass / islands 的层级。

**Recommended approach**

- 统一 header 背景使用与主界面接近的 nav/surface 逻辑。
- Tab 切换器不应像独立后台工具条，应更像主界面的次级 segmented control。
- 关闭按钮 hover/focus 强度与主界面 icon button 对齐。

**Acceptance**

- 设置 Header 与主聊天 Header 放在一起看，不会像来自两个不同主题。
- tab、关闭按钮、顶部边界在材质和交互反馈上连续。

#### Task C: 设置内容卡片统一到 islands surface 层级

**Target**

- `frontend/components/SettingsModal.tsx`
- `frontend/components/SettingsDrawer.tsx`

**What to change**

- 统一以下内容块：
  - Add Agent 表单卡片
  - Agent 列表表格容器
  - Provider 列表项
  - Provider 详情卡片
  - 确认删除弹窗
  - 任何 `bg-surface rounded-2xl border border-line` 旧卡片

**Recommended approach**

- 不要求所有内容块都套 `app-islands-panel`，但至少要分层清晰：
  - 外层抽屉：主 panel
  - 内层卡片：统一 surface 层
  - 可交互列表项：统一 item 层
- 若有必要，在 `globals.css` 增加 settings 专用辅助类，例如：
  - `app-islands-surface-card`
  - `app-islands-segment`
  - `app-islands-form-field`
- 但不要创建另一套完全独立 token。

**Acceptance**

- 设置内容区所有主要卡片属于同一材质层级。
- 不再出现一部分是 glass，一部分是厚重纯色卡片的混搭。

#### Task D: 表单输入与按钮状态统一

**Target**

- `frontend/components/SettingsModal.tsx`
- `frontend/components/SettingsDrawer.tsx`

**What to change**

- 统一以下控件的风格：
  - `input`
  - `textarea`
  - `select`
  - 主按钮
  - 次按钮
  - 危险按钮
  - 表格行 hover / 编辑态

**Recommended approach**

- 输入框复用主界面当前输入控件的透明度、边框和 focus 反馈。
- 主按钮延续主界面的强调色逻辑。
- 次按钮不要继续保留明显旧式灰底后台按钮感。
- 编辑态行与 hover 态要属于同一交互系统。

**Acceptance**

- 设置面板里的输入控件与聊天输入区是同一视觉家族。
- 主次按钮、危险按钮具备统一而可区分的状态层级。

#### Task E: 全局样式仅做增补，不做分叉

**Target**

- `frontend/app/globals.css`

**What to change**

- 如需为设置页补辅助类，只能在现有 islands 体系上增补。
- 不允许引入一套新的 settings token 与现有 `app-islands-*` 平行存在。

**Recommended approach**

- 优先复用：
  - `app-islands-panel`
  - `app-islands-input`
  - `app-islands-item`
- 如果现有类不够，新增类应是“子层级扩展”，不是新系统。

**Acceptance**

- `globals.css` 中不存在第二套独立设置主题系统。
- 设置面板样式来源可以追溯到同一组 islands 设计语言。

### Reviewer Checklist

- [ ] 设置抽屉外壳与主界面 panel 属于同一材质系统。
- [ ] 设置 header 与主聊天 header 的风格连续。
- [ ] 设置内容卡片不再混用 glass 与旧版 dashboard 卡片语言。
- [ ] 设置中的输入框、按钮、hover/focus 状态与主界面统一。
- [ ] 全局样式是在 `app-islands` 基础上扩展，而不是另起一套 theme。

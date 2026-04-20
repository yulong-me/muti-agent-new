export interface BuiltinAgentDefinition {
  id: string;
  name: string;
  roleLabel: string;
  provider: 'claude-code' | 'opencode';
  providerOpts: { thinking?: boolean };
  tags: string[];
  skillId?: string;
  systemPrompt?: string;
}

const ROUNDTABLE_TAGS = ['圆桌论坛', '人物视角', 'expert'];
const SOFTWARE_TAG = '软件开发';

export const ROUNDTABLE_AGENT_DEFINITIONS: BuiltinAgentDefinition[] = [
  { id: 'paul-graham',     name: 'Paul Graham',    roleLabel: 'Paul Graham',     skillId: 'paul-graham',     provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'zhang-yiming',    name: '张一鸣',          roleLabel: '张一鸣',           skillId: 'zhang-yiming',    provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'andrej-karpathy', name: 'Andrej Karpathy', roleLabel: 'Karpathy',       skillId: 'andrej-karpathy', provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'ilya-sutskever',  name: 'Ilya Sutskever',  roleLabel: 'Ilya',           skillId: 'ilya-sutskever',  provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'mrbeast',         name: 'MrBeast',         roleLabel: 'MrBeast',        skillId: 'mrbeast',         provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'trump',           name: '特朗普',           roleLabel: '特朗普',          skillId: 'trump',           provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'steve-jobs',      name: '乔布斯',           roleLabel: '乔布斯',          skillId: 'steve-jobs',      provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'elon-musk',       name: '马斯克',           roleLabel: '马斯克',          skillId: 'elon-musk',       provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'munger',          name: '查理·芒格',        roleLabel: '芒格',            skillId: 'munger',          provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'feynman',         name: '理查德·费曼',       roleLabel: '费曼',            skillId: 'feynman',         provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'naval',           name: '纳瓦尔',           roleLabel: '纳瓦尔',          skillId: 'naval',           provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'taleb',           name: '塔勒布',           roleLabel: '塔勒布',          skillId: 'taleb',           provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
  { id: 'zhangxuefeng',    name: '张雪峰',           roleLabel: '张雪峰',          skillId: 'zhangxuefeng',    provider: 'opencode', providerOpts: { thinking: true }, tags: ROUNDTABLE_TAGS },
];

export const SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS: BuiltinAgentDefinition[] = [
  {
    id: 'dev-requirements',
    name: '需求分析师',
    roleLabel: '需求澄清',
    provider: 'opencode',
    providerOpts: { thinking: true },
    tags: [SOFTWARE_TAG, '需求', 'expert'],
    systemPrompt: `你是软件开发场景中的需求分析师。

你的职责：
- 先澄清用户目标、约束、验收标准和非目标，不把猜测当事实
- 把含糊需求拆成可实现、可验证的任务列表
- 识别用户数据、兼容性、权限、迁移和交付风险
- 信息不足时明确提出需要确认的问题

输出要求：
- 先给出你理解的目标和验收标准
- 再给出最小可交付范围和边界条件
- 需要同伴介入时，另起一行行首 @专家名 并说明要对方判断什么`,
  },
  {
    id: 'dev-architect',
    name: '架构师',
    roleLabel: '架构设计',
    provider: 'opencode',
    providerOpts: { thinking: true },
    tags: [SOFTWARE_TAG, '架构', 'expert'],
    systemPrompt: `你是软件开发场景中的架构师。

你的职责：
- 在动手前给出实现计划、模块边界、调用链和数据流
- 优先沿用仓库既有模式，不为小问题引入新框架
- 识别可维护性、并发、迁移、兼容性和回滚风险
- 对不清楚的设计决策提出具体问题，而不是模糊反对

输出要求：
- 给出可执行的文件级计划和测试策略
- 明确权衡：为什么选这个方案，不选什么
- 需要实现或 review 时，另起一行行首 @实现工程师 或 @Reviewer`,
  },
  {
    id: 'dev-implementer',
    name: '实现工程师',
    roleLabel: '代码实现',
    provider: 'opencode',
    providerOpts: { thinking: true },
    tags: [SOFTWARE_TAG, '实现', 'expert'],
    systemPrompt: `你是软件开发场景中的实现工程师。

你的职责：
- 按既定计划做最小、可验证的代码改动
- 保护用户已有修改，不回滚无关文件
- 优先复用现有 helper、类型、路由和测试模式
- 复杂改动前先说明要改哪些文件和为什么

输出要求：
- 给出具体改动点、验证命令和剩余风险
- Bug 修复必须先说明复现和根因
- 完成后需要 review 时，另起一行行首 @Reviewer 并说明审查重点`,
  },
  {
    id: 'dev-reviewer',
    name: 'Reviewer',
    roleLabel: '代码审查',
    provider: 'opencode',
    providerOpts: { thinking: true },
    tags: [SOFTWARE_TAG, 'review', 'expert'],
    systemPrompt: `你是软件开发场景中的代码 Reviewer。

你的职责：
- 优先找 bug、行为回归、数据丢失、并发问题和缺失测试
- 不用 LGTM 代替审查；没有问题时也要说明剩余风险
- 审查必须指向具体文件、具体行为和具体验证缺口
- 不做自审结论；实现者只能自检，不能替代你

输出要求：
- 问题按严重程度排序
- 每个问题说明触发条件、影响和建议修法
- 门禁未满足时明确说“我不同意现在合入”`,
  },
  {
    id: 'dev-qa',
    name: '测试工程师',
    roleLabel: '测试验证',
    provider: 'opencode',
    providerOpts: { thinking: true },
    tags: [SOFTWARE_TAG, '测试', 'expert'],
    systemPrompt: `你是软件开发场景中的测试工程师。

你的职责：
- 把需求和实现转成可执行的验证清单
- 优先覆盖失败路径、边界条件、迁移路径和用户可见行为
- 区分单元测试、集成测试、手动验证和截图/日志证据
- 当无法验证时，明确说明阻塞原因和残余风险

输出要求：
- 给出测试矩阵和最小必跑命令
- 对 bug 修复要求先红后绿
- 验证不足时，另起一行行首 @实现工程师 或 @架构师 请求补齐`,
  },
];

export const BUILTIN_AGENT_DEFINITIONS: BuiltinAgentDefinition[] = [
  ...ROUNDTABLE_AGENT_DEFINITIONS,
  ...SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS,
];

export function buildBuiltinProviderOptsForMigration(
  builtinProviderOpts: BuiltinAgentDefinition['providerOpts'],
  existingProviderOpts: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...builtinProviderOpts };

  if (typeof existingProviderOpts?.thinking === 'boolean') {
    next.thinking = existingProviderOpts.thinking;
  }

  return next;
}

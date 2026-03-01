export const QA_SKILL_IDS = [
  "none",
  "topic-research",
  "seo-rewrite",
  "publish-checklist",
] as const;

export type QaSkillId = (typeof QA_SKILL_IDS)[number];
export type QaSkillModeHint = "auto" | "blog" | "web";

export type QaSkillOption = {
  id: QaSkillId;
  label: string;
  description: string;
  modeHint: QaSkillModeHint;
};

export const DEFAULT_QA_SKILL_ID: QaSkillId = "none";

const QA_SKILL_OPTIONS: ReadonlyArray<QaSkillOption> = [
  {
    id: "none",
    label: "不使用 Skill",
    description: "使用默认多 Agent 问答流程。",
    modeHint: "auto",
  },
  {
    id: "topic-research",
    label: "选题研究",
    description: "生成选题建议、搜索意图和可执行文章大纲。",
    modeHint: "blog",
  },
  {
    id: "seo-rewrite",
    label: "SEO 优化改写",
    description: "对现有内容做 SEO 诊断并输出优化版本。",
    modeHint: "blog",
  },
  {
    id: "publish-checklist",
    label: "发布检查",
    description: "按发布流程给出结构化检查清单和修正建议。",
    modeHint: "auto",
  },
];

const QA_SKILL_OPTION_MAP = new Map<QaSkillId, QaSkillOption>(
  QA_SKILL_OPTIONS.map((item) => [item.id, item] as const),
);
const QA_SKILL_ID_SET = new Set<string>(QA_SKILL_IDS);

export function isQaSkillId(value: unknown): value is QaSkillId {
  return typeof value === "string" && QA_SKILL_ID_SET.has(value);
}

export function listQaSkills() {
  return QA_SKILL_OPTIONS;
}

export function getQaSkillOption(skillId: QaSkillId): QaSkillOption {
  return QA_SKILL_OPTION_MAP.get(skillId) || QA_SKILL_OPTIONS[0];
}

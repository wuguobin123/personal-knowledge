import {
  DEFAULT_QA_SKILL_ID,
  getQaSkillOption,
  isQaBuiltinSkillId,
  type QaBuiltinSkillId,
  type QaSkillId,
  type QaSkillOption,
} from "@/lib/qa/skills-catalog";
import { getCustomQaSkill, toQaSkillOption } from "@/lib/qa/custom-skills";
import { tryAutoRunQaMcpTool } from "@/lib/qa/mcp-runtime";
import {
  runQaMultiAgentStream,
  type QaMessage,
  type QaMode,
  type QaMultiAgentStreamResult,
  type QaStreamMeta,
} from "@/lib/qa/multi-agent";

type QaSkillRuntimeRule = {
  modeOverride?: QaMode;
  instruction: string;
};

type QaSkillRuntimeHandlers = {
  onMeta?: (meta: QaStreamMeta & QaSkillMeta) => void;
  onThinkingDelta?: (text: string) => void;
  onAnswerDelta?: (text: string) => void;
  signal?: AbortSignal;
};

export type QaSkillMeta = {
  skillId: QaSkillId;
  skillLabel: string;
  skillDescription: string;
  mcpUsed?: boolean;
  mcpModuleKey?: string;
  mcpModuleLabel?: string;
  mcpToolName?: string;
  mcpReason?: string;
  mcpError?: string;
};

export type QaSkillStreamResult = QaMultiAgentStreamResult & QaSkillMeta;

const QA_SKILL_RULES: Record<Exclude<QaBuiltinSkillId, "none">, QaSkillRuntimeRule> = {
  "topic-research": {
    modeOverride: "blog",
    instruction: [
      "你在执行「选题研究」流程。",
      "输出要求：",
      "1) 给出 5 个可执行选题，并说明目标读者、搜索意图、建议标题（<= 28 字）。",
      "2) 为你最推荐的 1 个选题输出 H2/H3 结构化大纲。",
      "3) 给出该选题的关键词建议和写作风险提示。",
      "请使用 Markdown，优先表格 + 列表格式。",
    ].join("\n"),
  },
  "seo-rewrite": {
    modeOverride: "blog",
    instruction: [
      "你在执行「SEO 优化改写」流程。",
      "输出要求：",
      "1) 先给出 SEO 诊断（标题、结构、关键词、可读性、CTA）。",
      "2) 再输出优化后的版本，保持原意但更利于搜索和阅读。",
      "3) 如果用户没提供原文，要先索取原文并提供待补充信息清单。",
      "请使用 Markdown 小标题分段。",
    ].join("\n"),
  },
  "publish-checklist": {
    instruction: [
      "你在执行「发布检查」流程。",
      "输出要求：",
      "1) 按“目标读者 -> 核心观点 -> 结构 -> SEO -> CTA -> 事实核验”顺序检查。",
      "2) 对每个检查项给出“状态 + 风险 + 修复建议”。",
      "3) 最后给出发布前 Checklist（复选框列表）。",
      "请使用 Markdown，结构清晰。",
    ].join("\n"),
  },
};

function createSkillMeta(option: QaSkillOption): QaSkillMeta {
  return {
    skillId: option.id,
    skillLabel: option.label,
    skillDescription: option.description,
  };
}

function appendSkillInstruction(messages: QaMessage[], rule: QaSkillRuntimeRule) {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  if (latestUserIndex === -1) {
    return messages;
  }

  const nextMessages = [...messages];
  const original = nextMessages[latestUserIndex];
  const injected = [
    "[Skill Workflow]",
    rule.instruction,
    "",
    "[User Question]",
    original.content.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  nextMessages[latestUserIndex] = {
    ...original,
    content: injected,
  };

  return nextMessages;
}

export async function runQaSkillStream(
  input: {
    messages: QaMessage[];
    mode: QaMode;
    skillId?: QaSkillId;
    attachmentFileNames?: string[];
  },
  handlers: QaSkillRuntimeHandlers = {},
): Promise<QaSkillStreamResult> {
  const requestedSkillId = (input.skillId || DEFAULT_QA_SKILL_ID).trim() || DEFAULT_QA_SKILL_ID;
  let selectedOption = getQaSkillOption(DEFAULT_QA_SKILL_ID);
  let selectedRule: QaSkillRuntimeRule | undefined;

  if (requestedSkillId === DEFAULT_QA_SKILL_ID) {
    selectedOption = getQaSkillOption(DEFAULT_QA_SKILL_ID);
  } else if (isQaBuiltinSkillId(requestedSkillId)) {
    selectedOption = getQaSkillOption(requestedSkillId);
    if (requestedSkillId !== "none") {
      selectedRule = QA_SKILL_RULES[requestedSkillId];
    }
  } else {
    const customSkill = await getCustomQaSkill(requestedSkillId);
    if (customSkill && customSkill.isEnabled) {
      selectedOption = toQaSkillOption(customSkill);
      selectedRule = {
        instruction: customSkill.instruction,
        modeOverride: customSkill.modeHint === "auto" ? undefined : customSkill.modeHint,
      };
    }
  }

  const skillMeta = createSkillMeta(selectedOption);
  const effectiveMode = selectedRule?.modeOverride || input.mode;
  const mcpExecution = await tryAutoRunQaMcpTool({
    messages: input.messages,
    mode: effectiveMode,
    signal: handlers.signal,
    attachmentFileNames: input.attachmentFileNames,
  });
  const messagesWithMcp = mcpExecution.contextMessage
    ? [...input.messages, mcpExecution.contextMessage]
    : input.messages;
  const combinedMeta: QaSkillMeta = {
    ...skillMeta,
    mcpUsed: mcpExecution.used,
    mcpModuleKey: mcpExecution.moduleKey,
    mcpModuleLabel: mcpExecution.moduleLabel,
    mcpToolName: mcpExecution.toolName,
    mcpReason: mcpExecution.reason,
    mcpError: mcpExecution.error,
  };

  if (selectedOption.id === "none" || !selectedRule) {
    const result = await runQaMultiAgentStream(
      {
        messages: messagesWithMcp,
        mode: input.mode,
      },
      {
        ...handlers,
        onMeta(meta) {
          handlers.onMeta?.({
            ...meta,
            ...combinedMeta,
          });
        },
      },
    );

    return {
      ...result,
      ...combinedMeta,
    };
  }

  const enhancedMessages = appendSkillInstruction(messagesWithMcp, selectedRule);
  const mode = selectedRule.modeOverride || input.mode;

  const result = await runQaMultiAgentStream(
    {
      messages: enhancedMessages,
      mode,
    },
    {
      ...handlers,
      onMeta(meta) {
        handlers.onMeta?.({
          ...meta,
          ...combinedMeta,
        });
      },
    },
  );

  return {
    ...result,
    ...combinedMeta,
  };
}

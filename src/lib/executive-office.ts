export type ExecutiveDepartmentOverview = {
  department: string;
  status: '运行正常' | '待配置' | '待创建分身' | '待跟进';
  summary: string;
  progress: number;
};

export type ExecutiveExternalInsight = {
  category: string;
  content: string;
  source: string;
};

export type ExecutivePriorityTask = {
  priority: 'high' | 'medium' | 'low';
  task: string;
  deadline: string;
  assignedBy: string;
};

export type ExecutiveDailyBriefing = {
  date: string;
  generatedTime: string;
  headline: string;
  departmentOverview: ExecutiveDepartmentOverview[];
  externalInsights: ExecutiveExternalInsight[];
  priorityTasks: ExecutivePriorityTask[];
};

type BriefingInput = {
  integrations: Array<{
    provider: string;
    status: string;
    snapshots: Array<{ summary: string; createdAt: Date }>;
  }>;
  wechatSources: Array<{
    displayName: string;
    description: string | null;
    updatedAt: Date;
  }>;
  avatars: Array<{
    name: string;
    chats: Array<{ needsInvestorReview: boolean; qualificationStatus: string }>;
  }>;
  now?: Date;
};

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildExecutiveDailyBriefing(input: BriefingInput): ExecutiveDailyBriefing {
  const now = input.now || new Date();
  const date = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const connectedIntegrations = input.integrations.filter((it) => it.status === 'CONNECTED');
  const gmailConnected = connectedIntegrations.some((it) => it.provider === 'GMAIL');
  const feishuConnected = connectedIntegrations.some((it) => it.provider === 'FEISHU');
  const wechatConnected = input.wechatSources.length > 0;

  const totalChats = input.avatars.reduce((acc, avatar) => acc + avatar.chats.length, 0);
  const reviewChats = input.avatars.reduce(
    (acc, avatar) => acc + avatar.chats.filter((chat) => chat.needsInvestorReview).length,
    0
  );
  const qualifiedChats = input.avatars.reduce(
    (acc, avatar) => acc + avatar.chats.filter((chat) => chat.qualificationStatus === 'QUALIFIED').length,
    0
  );

  const processedInfoCount =
    connectedIntegrations.length * 8 + input.wechatSources.length * 3 + Math.max(0, reviewChats * 2);
  const infoOpsProgress = clampProgress(
    (gmailConnected ? 35 : 0) + (feishuConnected ? 30 : 0) + (wechatConnected ? 35 : 0)
  );
  const twinOpsProgress = clampProgress(input.avatars.length > 0 ? 55 + Math.min(40, totalChats * 4) : 0);
  const followUpProgress = clampProgress(totalChats > 0 ? 45 + Math.min(35, reviewChats * 10 + qualifiedChats * 4) : 0);

  const latestIntegrationSummary = connectedIntegrations
    .map((it) => it.snapshots[0])
    .filter(Boolean)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  const latestWechatSummary = input.wechatSources[0]?.description || '';
  const topExternalContent =
    latestIntegrationSummary?.summary?.slice(0, 160) ||
    latestWechatSummary.slice(0, 160) ||
    '暂无外部来源摘要，建议优先完成 Gmail/飞书/公众号接入。';

  const priorityTasks: ExecutivePriorityTask[] = [];
  if (!gmailConnected) {
    priorityTasks.push({
      priority: 'high',
      task: '完成 Gmail 绑定并首次拉取摘要',
      deadline: '今日内',
      assignedBy: '总裁秘书Momo',
    });
  }
  if (!feishuConnected) {
    priorityTasks.push({
      priority: 'medium',
      task: '完成 飞书 绑定并校验协作摘要',
      deadline: '今日内',
      assignedBy: '总裁秘书Momo',
    });
  }
  if (!wechatConnected) {
    priorityTasks.push({
      priority: 'medium',
      task: '录入至少 1 个公众号源',
      deadline: '本周内',
      assignedBy: '公众号助手小智',
    });
  }
  if (reviewChats > 0) {
    priorityTasks.push({
      priority: 'high',
      task: `跟进 ${reviewChats} 个待人工介入会话`,
      deadline: '今日 18:00 前',
      assignedBy: '会话跟进助手',
    });
  }
  if (priorityTasks.length < 3) {
    priorityTasks.push({
      priority: 'medium',
      task: '审阅今日摘要并补充团队行动项',
      deadline: '今日 20:00 前',
      assignedBy: '总裁秘书Momo',
    });
  }

  return {
    date,
    generatedTime: '今天 06:00',
    headline: `今日已汇总 ${processedInfoCount} 条信息流，当前有 ${priorityTasks.filter((item) => item.priority === 'high').length} 项高优先级事项需要关注。`,
    departmentOverview: [
      {
        department: '总裁办',
        status: '运行正常',
        summary: '总裁秘书负责跨部门信息汇总、晨报生成与重点事项提醒。',
        progress: 100,
      },
      {
        department: '信息处理运营部门',
        status: infoOpsProgress > 0 ? '运行正常' : '待配置',
        summary:
          infoOpsProgress > 0
            ? `已接入 ${connectedIntegrations.length} 个外部集成与 ${input.wechatSources.length} 个公众号源，信息处理链路可用。`
            : '尚未完成外部渠道接入，建议优先配置 Gmail、飞书、公众号。',
        progress: infoOpsProgress,
      },
      {
        department: '数字分身运营部门',
        status: input.avatars.length > 0 ? '运行正常' : '待创建分身',
        summary:
          input.avatars.length > 0
            ? `当前共有 ${input.avatars.length} 个分身，累计会话 ${totalChats} 次。`
            : '尚未创建可运营分身，建议先完善默认分身。',
        progress: twinOpsProgress,
      },
      {
        department: '会话跟进部门',
        status: totalChats > 0 ? '运行正常' : '待跟进',
        summary:
          totalChats > 0
            ? `当前待人工介入 ${reviewChats} 个会话，已达标会话 ${qualifiedChats} 个。`
            : '暂无候选人会话，后续将自动跟进新增对话。',
        progress: followUpProgress,
      },
    ],
    externalInsights: [
      {
        category: '渠道摘要',
        content: topExternalContent,
        source: '来自已接入渠道',
      },
      {
        category: '组织效率',
        content:
          reviewChats > 0
            ? '建议先处理待人工介入会话，再补齐低优先级配置项，可显著提升后续转化效率。'
            : '当前会话风险较低，可把时间优先投入到渠道补齐与分身调优。',
        source: '总裁办策略建议（规则生成）',
      },
      {
        category: '系统提示',
        content: '晨报当前为规则化生成，后续可接入更细粒度外部情报源与模型总结链路。',
        source: '系统状态',
      },
    ],
    priorityTasks: priorityTasks.slice(0, 4),
  };
}

export function buildExecutiveAssistantReply(question: string, briefing: ExecutiveDailyBriefing) {
  const normalized = question.toLowerCase();

  if (/部门|工作|概览|团队|组织/.test(normalized)) {
    return [
      '各部门今日概览：',
      ...briefing.departmentOverview.map(
        (item) => `- ${item.department}：${item.status}（进度 ${item.progress}%）\n  ${item.summary}`
      ),
      '',
      '需要我继续展开某一个部门的详细行动建议吗？',
    ].join('\n');
  }

  if (/外界|行业|动态|趋势|情报/.test(normalized)) {
    return [
      '外界与渠道信息摘要：',
      ...briefing.externalInsights.map((item) => `- ${item.category}：${item.content}（${item.source}）`),
      '',
      '如需，我可以把这些信息按“投资判断/执行风险/机会窗口”三类再重排一次。',
    ].join('\n');
  }

  if (/重点|任务|待办|优先级/.test(normalized)) {
    return [
      '今日重点事项：',
      ...briefing.priorityTasks.map(
        (item, index) => `${index + 1}. [${item.priority.toUpperCase()}] ${item.task}（截止：${item.deadline}，分配：${item.assignedBy}）`
      ),
      '',
      '建议优先处理 HIGH 项，再处理配置类 MEDIUM 项。',
    ].join('\n');
  }

  if (/晨报|报告|完整/.test(normalized)) {
    return [
      `今日晨报（${briefing.date}，${briefing.generatedTime}）：`,
      briefing.headline,
      '',
      '包含三个模块：',
      '1) 各部门工作概览',
      '2) 外界信息精选',
      '3) 今日重点事项',
      '',
      '你可以直接问我“展开部门概览 / 展开重点任务 / 展开外界趋势”。',
    ].join('\n');
  }

  return [
    `晨报已就绪：${briefing.headline}`,
    '你可以让我做以下任一项：',
    '- 汇报各部门工作情况',
    '- 列出今天的重点事项',
    '- 总结外界信息变化',
    '- 给出执行优先级建议',
  ].join('\n');
}

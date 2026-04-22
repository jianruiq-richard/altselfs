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
  hiredTeamKeys?: string[];
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
  const engineeringProgress = clampProgress(input.avatars.length > 0 ? 50 + Math.min(40, totalChats * 4) : 0);
  const hiredTeamSet = new Set(input.hiredTeamKeys || []);

  const opcTracks = 'AI视频、AI Agent 等 OPC 预设产品领域赛道';
  const technologyInsight =
    connectedIntegrations.length > 0 || input.wechatSources.length > 0
      ? `技术趋势围绕 ${opcTracks} 进行，已由当前雇佣员工在各自渠道持续搜集信号；建议继续细化赛道关键词与技术标签，提升趋势判断精度。`
      : `技术趋势围绕 ${opcTracks} 进行，但当前尚未接入可用渠道，建议先完成至少 1 个外部渠道接入后再启动趋势追踪。`;
  const competitorInsight =
    input.wechatSources.length > 0
      ? `竞品监控由已雇佣的“公众号助手”及“小红书助手”（含未来新增渠道助手）按你的监控指令每日整理，重点跟踪是否有新竞品发布、在各渠道的推广动作与声量变化。`
      : '竞品监控暂缺可用渠道样本，建议先补齐公众号与小红书等来源，并配置需要重点监控的赛道与产品名单。';
  const industryTrackInsight =
    connectedIntegrations.length > 0 || input.wechatSources.length > 0
      ? `行业动态围绕 ${opcTracks} 汇总，按员工负责渠道持续采集并更新。`
      : `行业动态将围绕 ${opcTracks} 汇总，待接入渠道后自动启动采集。`;

  const priorityTasks: ExecutivePriorityTask[] = [];
  if (hiredTeamSet.has('info_ops') && !gmailConnected) {
    priorityTasks.push({
      priority: 'high',
      task: '完成 Gmail 绑定并首次拉取摘要',
      deadline: '今日内',
      assignedBy: '总裁秘书Momo',
    });
  }
  if (hiredTeamSet.has('info_ops') && !feishuConnected) {
    priorityTasks.push({
      priority: 'medium',
      task: '完成 飞书 绑定并校验协作摘要',
      deadline: '今日内',
      assignedBy: '总裁秘书Momo',
    });
  }
  if (hiredTeamSet.has('info_ops') && !wechatConnected) {
    priorityTasks.push({
      priority: 'medium',
      task: '录入至少 1 个公众号源',
      deadline: '本周内',
      assignedBy: '公众号助手小智',
    });
  }
  if (hiredTeamSet.has('engineering') && reviewChats > 0) {
    priorityTasks.push({
      priority: 'high',
      task: `跟进 ${reviewChats} 个待人工介入会话`,
      deadline: '今日 18:00 前',
      assignedBy: '总裁秘书Momo',
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

  const departmentOverview: ExecutiveDepartmentOverview[] = [];

  if (hiredTeamSet.has('executive_office')) {
    departmentOverview.push({
      department: '总裁办',
      status: '运行正常',
      summary: '总裁秘书负责跨部门信息汇总、晨报生成与重点事项提醒。',
      progress: 100,
    });
  }

  if (hiredTeamSet.has('info_ops')) {
    departmentOverview.push({
      department: '信息处理运营部门',
      status: infoOpsProgress > 0 ? '运行正常' : '待配置',
      summary:
        infoOpsProgress > 0
          ? `已接入 ${connectedIntegrations.length} 个外部集成与 ${input.wechatSources.length} 个公众号源，信息处理链路可用。`
          : '尚未完成外部渠道接入，建议优先配置 Gmail、飞书、公众号。',
      progress: infoOpsProgress,
    });
  }

  if (hiredTeamSet.has('engineering')) {
    departmentOverview.push({
      department: '研发团队',
      status: input.avatars.length > 0 ? '运行正常' : '待配置',
      summary:
        input.avatars.length === 0
          ? '研发团队已雇佣，默认 AI 员工已配置，等待分身与会话数据接入。'
          : reviewChats > 0
          ? `当前共有 ${input.avatars.length} 个分身，累计会话 ${totalChats} 次，待人工介入 ${reviewChats} 个。`
          : `当前共有 ${input.avatars.length} 个分身，累计会话 ${totalChats} 次，已达标会话 ${qualifiedChats} 个。`,
      progress: engineeringProgress,
    });
  }

  if (hiredTeamSet.has('marketing_ops')) {
    departmentOverview.push({
      department: '营销运营团队',
      status: '待配置',
      summary: '营销运营团队已雇佣，默认 AI 员工已配置，待接入营销渠道与推广监控规则后自动更新进展。',
      progress: 20,
    });
  }

  return {
    date,
    generatedTime: '今天 06:00',
    headline: `今日已汇总 ${processedInfoCount} 条信息流，当前有 ${priorityTasks.filter((item) => item.priority === 'high').length} 项高优先级事项需要关注。`,
    departmentOverview,
    externalInsights: [
      {
        category: '行业动态',
        content: industryTrackInsight,
        source: '来自已接入渠道',
      },
      {
        category: '技术趋势',
        content: technologyInsight,
        source: '系统链路评估',
      },
      {
        category: '竞品监控',
        content: competitorInsight,
        source: '渠道覆盖评估',
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
      '1) 外界信息精选',
      '2) 各部门工作概览',
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

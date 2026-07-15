export type ExecutiveDepartmentOverview = {
  department: string;
  status: 'Healthy' | 'Setup needed' | 'Create a twin' | 'Follow-up needed';
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
  const date = now.toLocaleDateString('en-US', {
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

  const decisionTracks = 'personal decision twins, AI workflows, cross-channel context aggregation, and action recommendations';
  const crossChannelInsight =
    connectedIntegrations.length > 0 || input.wechatSources.length > 0
      ? `A baseline information loop has been established around ${decisionTracks}. Current AI teammates will keep collecting signals from connected channels. Refine focus areas and exclusions to improve decision quality.`
      : `Decision OS will consolidate information around ${decisionTracks}. No usable channels are connected yet; complete at least one external channel connection first.`;
  const twinRecommendationInsight =
    input.wechatSources.length > 0
      ? 'External signal sources are available. Key people, product leads, and partnership opportunities can be explored further with a Personal Decision Twin.'
      : 'Twin Recommendations needs more channel samples. Connect WeChat Official Accounts, Xiaohongshu, Gmail, Lark, and similar sources first.';

  const priorityTasks: ExecutivePriorityTask[] = [];
  if (hiredTeamSet.has('info_ops') && !gmailConnected) {
    priorityTasks.push({
      priority: 'high',
      task: 'Connect Gmail and pull the first summary',
      deadline: 'Today',
      assignedBy: 'Executive Assistant Momo',
    });
  }
  if (hiredTeamSet.has('info_ops') && !feishuConnected) {
    priorityTasks.push({
      priority: 'medium',
      task: 'Connect Lark and verify the collaboration summary',
      deadline: 'Today',
      assignedBy: 'Executive Assistant Momo',
    });
  }
  if (hiredTeamSet.has('info_ops') && !wechatConnected) {
    priorityTasks.push({
      priority: 'medium',
      task: 'Add at least one WeChat Official Account source',
      deadline: 'This week',
      assignedBy: 'WeChat Assistant',
    });
  }
  if (hiredTeamSet.has('engineering') && reviewChats > 0) {
    priorityTasks.push({
      priority: 'high',
      task: `Follow up on ${reviewChats} conversations that need human review`,
      deadline: 'Today by 6:00 PM',
      assignedBy: 'Executive Assistant Momo',
    });
  }
  if (priorityTasks.length < 3) {
    priorityTasks.push({
      priority: 'medium',
      task: 'Review today Decision Briefing and add personal decision preferences',
      deadline: 'Today by 8:00 PM',
      assignedBy: 'Executive Assistant Momo',
    });
  }

  const departmentOverview: ExecutiveDepartmentOverview[] = [];

  if (hiredTeamSet.has('executive_office')) {
    departmentOverview.push({
      department: 'Executive Office',
      status: 'Healthy',
      summary: 'The executive assistant owns cross-team information digestion, briefing generation, and priority reminders.',
      progress: 100,
    });
  }

  if (hiredTeamSet.has('info_ops')) {
    departmentOverview.push({
      department: 'Information Operations',
      status: infoOpsProgress > 0 ? 'Healthy' : 'Setup needed',
      summary:
        infoOpsProgress > 0
          ? `Connected ${connectedIntegrations.length} external integrations and ${input.wechatSources.length} WeChat Official Account sources; the information operations loop is ready.`
          : 'External channel setup is not complete. Prioritize Gmail, Lark, and WeChat Official Accounts.',
      progress: infoOpsProgress,
    });
  }

  if (hiredTeamSet.has('engineering')) {
    departmentOverview.push({
      department: 'Engineering',
      status: input.avatars.length > 0 ? 'Healthy' : 'Setup needed',
      summary:
        input.avatars.length === 0
          ? 'Engineering has been hired and default AI teammates are configured. Waiting for twin and conversation data.'
          : reviewChats > 0
          ? `There are currently ${input.avatars.length} twins, ${totalChats} total conversations, and ${reviewChats} needing human review.`
          : `There are currently ${input.avatars.length} twins, ${totalChats} total conversations, and ${qualifiedChats} qualified conversations.`,
      progress: engineeringProgress,
    });
  }

  if (hiredTeamSet.has('marketing_ops')) {
    departmentOverview.push({
      department: 'Marketing Operations',
      status: 'Setup needed',
      summary: 'Marketing Operations has been hired and default AI teammates are configured. Progress will update after marketing channels and campaign monitoring rules are connected.',
      progress: 20,
    });
  }

  return {
    date,
    generatedTime: '6:00 AM today',
    headline: `Today briefing consolidated ${processedInfoCount} information streams. ${priorityTasks.filter((item) => item.priority === 'high').length} high-priority items need attention.`,
    departmentOverview,
    externalInsights: [
      {
        category: 'Information Digest',
        content: crossChannelInsight,
        source: 'Decision OS',
      },
      {
        category: 'Today To-Dos',
        content:
          priorityTasks.length > 0
            ? `There are ${priorityTasks.length} to-dos. Prioritize ${priorityTasks.filter((item) => item.priority === 'high').length} high-priority items first.`
            : 'After the briefing is updated, the executive assistant will extract actionable items from all message channels.',
        source: 'Executive Assistant Momo',
      },
      {
        category: 'Twin Recommendations',
        content: twinRecommendationInsight,
        source: 'Personal Decision Twin',
      },
    ],
    priorityTasks: priorityTasks.slice(0, 4),
  };
}

export function buildExecutiveAssistantReply(question: string, briefing: ExecutiveDailyBriefing) {
  const normalized = question.toLowerCase();

  if (/department|team|overview|work|organization|org/.test(normalized)) {
    return [
      'Today team overview:',
      ...briefing.departmentOverview.map(
        (item) => `- ${item.department} - ${item.status} (progress ${item.progress}%)\n  ${item.summary}`
      ),
      '',
      'Would you like me to expand the action plan for one team?',
    ].join('\n');
  }

  if (/market|industry|trend|intelligence|external|news/.test(normalized)) {
    return [
      'Information Digest - ',
      ...briefing.externalInsights.map((item) => `- ${item.category} - ${item.content} (${item.source})`),
      '',
      'I can also regroup this into decision rationale, execution risk, and next actions.',
    ].join('\n');
  }

  if (/priority|task|todo|to-do|action/.test(normalized)) {
    return [
      "Today priorities:",
      ...briefing.priorityTasks.map(
        (item, index) => `${index + 1}. [${item.priority.toUpperCase()}] ${item.task} (Due: ${item.deadline}, owner: ${item.assignedBy})`
      ),
      '',
      'Handle HIGH items first, then MEDIUM setup items.',
    ].join('\n');
  }

  if (/briefing|report|full/.test(normalized)) {
    return [
      `Today briefing (${briefing.date}, ${briefing.generatedTime}):`,
      briefing.headline,
      '',
      'It includes three modules:',
      '1) Information Digest',
      '2) Today To-Dos',
      '3) Twin Recommendations',
      '',
      'You can ask me to expand Information Digest, Today To-Dos, or Twin Recommendations.',
    ].join('\n');
  }

  return [
    `The briefing is ready: ${briefing.headline}`,
    'You can ask me to:',
    '- Report Decision OS operating status',
    '- List today priorities',
    '- Summarize cross-channel information changes',
    '- Recommend execution priorities',
  ].join('\n');
}

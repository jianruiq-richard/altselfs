import type { ExecutiveDailyBriefing } from '@/lib/executive-office';

export const BP_DEMO_EMAIL = 'jianruiq@163.com';

type BpDemoBriefingSection = {
  title: string;
  content: string;
  items: Array<{
    title: string;
    summary: string;
    source: string;
    url?: string;
    publishedAt: string;
  }>;
};

export type BpDemoPersistedBriefing = {
  dateKey: string;
  title: string;
  summary: string;
  sections: BpDemoBriefingSection[];
  updatedAt: string;
};

export type BpDemoChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export function isBpDemoUserEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === BP_DEMO_EMAIL;
}

export function buildBpDemoDecisionChatMessages(): BpDemoChatMessage[] {
  return [
    {
      role: 'user',
      content: 'Ron 说我不要总是推演、复盘和建立数据模型，要敢于做一些有创意、很酷的事情。你怎么看？我应该怎么回他？',
    },
    {
      role: 'assistant',
      content:
        '我先结合你的历史 context 判断一下。过去两周你在飞书会议、Gmail 更新和 BP 版本里，反复强调了三类内容：用户增长模型、信息源覆盖率、agent 调度链路稳定性。\n这些内容本身没错，但 Ron 可能听到的是：你在证明这个方向“合理”，而不是在展示你真的“想把它做出来”。',
    },
    {
      role: 'user',
      content: '所以他不是反对数据分析？',
    },
    {
      role: 'assistant',
      content:
        '不是。他更像是在提醒你：现在 BP 里理性论证太多，创始人气质和产品野心不够明显。\n你的 Decision OS 显示，你遇到不确定性时，会倾向于继续收集信息、拆模型、找证据。这让你决策更稳，但也容易让外部投资人觉得你在防守，而不是进攻。',
    },
    {
      role: 'user',
      content: '那我应该怎么回复 Ron？',
    },
    {
      role: 'assistant',
      content:
        '建议你不要解释“为什么数据分析也重要”。那会继续落入他指出的问题。\n你应该承认他的判断，然后给出一个具体转向：你会把下一版 BP 从“解释系统为什么成立”，改成“展示这个产品会让用户获得什么超能力”。',
    },
  ];
}

function dateKey(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  });
  return formatter.format(now);
}

function zhDate(now: Date) {
  return now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  });
}

function publishedAt(hour: number, minute: number, now: Date) {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  return next.toISOString();
}

export function buildBpDemoDailyBriefing(now = new Date()): ExecutiveDailyBriefing {
  return {
    date: zhDate(now),
    generatedTime: '今天 06:40',
    headline: '今日晨报已完成：信息汇总 6 条，其中 Discord 服务稳定性需要优先检查。',
    departmentOverview: [
      {
        department: '总裁办',
        status: '运行正常',
        summary: '总裁秘书Momo已把外部渠道、Gmail、Discord 与飞书日报汇总为可截图的晨报视图。',
        progress: 100,
      },
      {
        department: '信息处理运营部门',
        status: '运行正常',
        summary: '已接入 36氪公众号、小红书、Gmail、Discord 与飞书，信息处理链路运行正常。',
        progress: 92,
      },
    ],
    externalInsights: [
      {
        category: '信息汇总',
        content: '36氪公众号出现“AI产品的大众点评”平台线索，小红书 AI 相机推广笔记互动较高，均与 OPC 方向的产品发现和消费级传播有关。',
        source: '总裁秘书Momo',
      },
      {
        category: '业务相关更新',
        content: 'Gmail、Discord 与飞书信号显示：投资人建议更大胆，合作方视频草稿待审核，社群昨晚疑似服务异常，Alex 昨日未交日报。',
        source: '总裁秘书Momo',
      },
    ],
    priorityTasks: [
      {
        priority: 'high',
        task: '检查 Discord 社群昨晚投诉对应的服务可用性与告警记录',
        deadline: '今日 10:30 前',
        assignedBy: '总裁秘书Momo',
      },
      {
        priority: 'high',
        task: '审核 Amir Mass 发来的推广视频草稿并回复当前状态',
        deadline: '今日 12:00 前',
        assignedBy: '总裁秘书Momo',
      },
      {
        priority: 'medium',
        task: '把 Ron 的反馈转成下一版 BP 产品表达：更有创意、更酷、更少推演感',
        deadline: '今日 18:00 前',
        assignedBy: '总裁秘书Momo',
      },
      {
        priority: 'medium',
        task: '提醒 Alex 补交昨日实习生日报',
        deadline: '今日内',
        assignedBy: '飞书助手小红',
      },
    ],
  };
}

export function buildBpDemoPersistedBriefing(now = new Date()): BpDemoPersistedBriefing {
  const updatedAt = publishedAt(6, 40, now);

  return {
    dateKey: dateKey(now),
    title: 'BP 展示晨报',
    summary: '信息汇总 6 条。重点关注：OPC 产品发现平台、小红书 AI 相机传播、Ron 的产品表达建议、Amir 视频草稿、Discord 服务异常与飞书日报缺口。',
    updatedAt,
    sections: [
      {
        title: '信息汇总',
        content: '围绕 OPC 方向、消费级 AI 产品传播和业务推进，今日汇总到 6 条关键信息信号。',
        items: [
          {
            title: '微信公众号36氪推荐了一个新的Agent无限记忆技术',
            summary: '监控AI技术发展，你可能会感兴趣。',
            source: '36氪公众号',
            url: 'https://36kr.com/',
            publishedAt: publishedAt(7, 12, now),
          },
          {
            title: '小红书这几天有一款AI相机产品的笔记评论互动很多',
            summary: '一个有意思击中真实痛点的产品，但是没有长期壁垒。',
            source: '小红书',
            publishedAt: publishedAt(8, 5, now),
          },
          {
            title: 'Gmail收到投资人Ron的交流邮件',
            summary: '他建议你多做直觉上很酷的事情，不要总是复盘数据驱动。',
            source: 'Gmail · Ron',
            publishedAt: publishedAt(8, 28, now),
          },
          {
            title: 'Gmail收到KOL的询问邮件',
            summary: 'Amir询问推广视频草稿已经来两天了在等待审批，但是还没反馈。',
            source: 'Gmail · Amir Mass',
            publishedAt: publishedAt(8, 43, now),
          },
          {
            title: '你的Discord频道昨晚收到集中投诉',
            summary: '大部分都说服务异常产品不可用。',
            source: 'Discord 社群',
            publishedAt: publishedAt(9, 2, now),
          },
          {
            title: '昨日实习生Alex飞书上没发日报',
            summary: '其他同学都做了总结。',
            source: '飞书日报',
            publishedAt: publishedAt(9, 18, now),
          },
        ],
      },
      {
        title: '今日to do',
        content: '今日有 5 个待办事项，优先处理产品服务稳定性，再处理关键关系和团队节奏。',
        items: [
          {
            title: '红色P0 最高优先级检查修复产品服务',
            summary: '用户体验是第一位的，另外建议要求工程负责人给一个复盘以及防止再次出现的解决方案。',
            source: '总裁秘书Momo',
            publishedAt: publishedAt(9, 35, now),
          },
          {
            title: '黄色P1 回复投资人Ron的邮件',
            summary: '回复这封邮件很重要，但是不用第一时间回复。你需要思考在Ron看来，你最大的困难是什么。',
            source: '总裁秘书Momo',
            publishedAt: publishedAt(9, 42, now),
          },
          {
            title: '黄色P1 询问Alex昨天的工作完成情况',
            summary: '按照你的习惯，团队的推进节奏很重要，需要了解Alex具体是什么原因没有发日报。',
            source: '飞书日报',
            publishedAt: publishedAt(9, 48, now),
          },
          {
            title: '绿色P2 请算法同学测试一下36氪推荐的无限记忆Agent机制',
            summary: '重要不紧急，看看能否用于提升产品使用体验。',
            source: '36氪公众号',
            publishedAt: publishedAt(10, 4, now),
          },
          {
            title: '绿色P2 零碎时间体验一下小红书上很火的AI相机',
            summary: '保持一下对外界AI新产品的敏感度。',
            source: '小红书',
            publishedAt: publishedAt(10, 12, now),
          },
        ],
      },
      {
        title: '分身推荐',
        content: '今日有 1 个由分身匹配到的潜在合作对象，建议你亲自判断是否发起沟通。',
        items: [
          {
            title: '匹配到一位个人独立开发者',
            summary: '我发现平台上有一位个人独立开发者，做事习惯方式和愿景和你现在做的很像，要不要聊一下看看是否愿意作为后台架构师加入团队？',
            source: '分身匹配',
            publishedAt: publishedAt(10, 8, now),
          },
        ],
      },
    ],
  };
}

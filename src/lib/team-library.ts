export const TEAM_KEYS = {
  EXECUTIVE_OFFICE: 'executive_office',
  INFO_OPS: 'info_ops',
  ENGINEERING: 'engineering',
  MARKETING_OPS: 'marketing_ops',
} as const;

export type TeamKey = (typeof TEAM_KEYS)[keyof typeof TEAM_KEYS];

export const TEAM_LIBRARY: Array<{
  key: TeamKey;
  name: string;
  defaultAgentName: string;
}> = [
  { key: TEAM_KEYS.EXECUTIVE_OFFICE, name: '总裁办', defaultAgentName: '总裁秘书Momo' },
  { key: TEAM_KEYS.INFO_OPS, name: '信息处理运营部门', defaultAgentName: '信息助手小明' },
  { key: TEAM_KEYS.ENGINEERING, name: '研发团队', defaultAgentName: '研发助手Alpha' },
  { key: TEAM_KEYS.MARKETING_OPS, name: '营销运营团队', defaultAgentName: '营销助手Beta' },
];

const MARKETING_AGENT_TYPES = new Set([
  'DISCORD',
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'GROWTH',
  'MARKETING',
  'MARKETING_OPS',
]);

export function inferLegacyHiredTeamKeys(input: {
  integrationCount: number;
  wechatSourceCount: number;
  avatarCount: number;
  agentTypes: string[];
}) {
  const teams = new Set<TeamKey>([TEAM_KEYS.EXECUTIVE_OFFICE]);
  if (input.integrationCount > 0 || input.wechatSourceCount > 0) {
    teams.add(TEAM_KEYS.INFO_OPS);
  }
  if (input.avatarCount > 0) {
    teams.add(TEAM_KEYS.ENGINEERING);
  }
  const hasMarketingAgent = input.agentTypes.some((type) => MARKETING_AGENT_TYPES.has(type.toUpperCase()));
  if (hasMarketingAgent) {
    teams.add(TEAM_KEYS.MARKETING_OPS);
  }
  return teams;
}

export function resolveHiredTeamKeys(input: {
  teamHires: Array<{ teamKey: string; status: string }>;
  fallback: {
    integrationCount: number;
    wechatSourceCount: number;
    avatarCount: number;
    agentTypes: string[];
  };
}) {
  if (input.teamHires.length > 0) {
    const explicit = input.teamHires
      .filter((it) => it.status === 'HIRED')
      .map((it) => it.teamKey as TeamKey);
    return new Set<TeamKey>(explicit);
  }
  return inferLegacyHiredTeamKeys(input.fallback);
}

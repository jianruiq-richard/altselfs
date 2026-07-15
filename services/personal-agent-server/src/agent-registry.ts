import type { AgentProfile, ChildAgentRuntime } from './types.js';

export class AgentRegistry {
  private runtimes = new Map<string, ChildAgentRuntime>();
  private profiles = new Map<string, AgentProfile>();

  constructor(profiles: AgentProfile[] = defaultAgentProfiles()) {
    for (const profile of profiles) this.profiles.set(profile.id, profile);
  }

  register(runtime: ChildAgentRuntime) {
    this.runtimes.set(runtime.id, runtime);
  }

  get(id: string) {
    return this.runtimes.get(id);
  }

  list() {
    return Array.from(this.runtimes.values()).map((runtime) => ({
      id: runtime.id,
      description: runtime.description,
    }));
  }

  getProfile(id: string) {
    return this.profiles.get(id);
  }

  listProfiles() {
    return Array.from(this.profiles.values());
  }

  listAvailableProfiles(allowedProfileIds?: string[]) {
    const allowed = allowedProfileIds?.length ? new Set(allowedProfileIds) : null;
    return this.listProfiles().filter((profile) => {
      if (profile.visibleToRouter === false) return false;
      if (allowed && !allowed.has(profile.id)) return false;
      return this.runtimes.has(profile.runtimeId);
    });
  }
}

export function defaultAgentProfiles(): AgentProfile[] {
  return [
    {
      id: 'codex-general',
      runtimeId: 'codex',
      name: 'General Discussion and Research Agent',
      description:
        'The single execution and capability hub under Hermes. It handles reasoning, research, web search, tool use, future channel agents, and task orchestration. Local workspace, shell, files, and patching are disabled.',
      capabilities: [
        'Handle complex discussion, analysis, and reasoning delegated by Hermes',
        'Retrieve external information through available web tools',
        'Coordinate future executive briefing, WeChat, Xiaohongshu, email, Lark, and other tools or child agents',
        'Organize materials, compare options, and recommend decisions',
        'Maintain context for a complex task inside the Codex agent loop',
      ],
      whenToUse: [
        'The user wants to discuss a problem, research external information, organize materials, or get advice',
        'The user requests web search, industry updates, current information, tool use, or child-agent capability',
        'The user requests planning, option comparison, complex decision support, or action recommendations',
        'The task needs multi-step reasoning or tool use, but does not require modifying a real code repository',
      ],
      whenNotToUse: [
        'The user only asks Hermes to remember preferences, update the user profile, or handle a very lightweight greeting or confirmation',
        'The user explicitly asks to edit code, inspect a local repository, run commands, or debug builds',
      ],
      tools: [
        'codex_agent_loop',
        'conversation',
        'reasoning',
        'current_time_context',
        'altselfs_web_search',
        'provider_backed_web_search_serpapi_serper_google_cse_or_bing',
        'non_local_mcp_or_platform_tools_when_configured',
      ],
      riskLevel: 'medium',
      requiresWorkspace: false,
      requiresApprovalFor: ['third_party_api_call'],
    },
    {
      id: 'codex-competitive-intelligence',
      runtimeId: 'codex',
      name: 'Competitive Intelligence Agent',
      description:
        'A specialized Codex profile for competitive intelligence, growth-channel analysis, SEO/PPC research, market positioning, user/traffic proxy analysis, revenue estimation, and evidence-based competitor synthesis. It uses enabled information-source agents such as Semrush, Similarweb, Google, YouTube, X/Twitter, Facebook, WeChat, Xiaohongshu, Gmail, and Feishu when available.',
      capabilities: [
        'Identify direct competitors, indirect competitors, SEO/PPC competitors, and channel competitors',
        'Organize evidence around users, traffic, revenue, growth rate, and acquisition motion',
        'Prioritize enabled information-source teammates such as Similarweb API1, Semrush13, Semrush8, Domain Metrics Check, and future Google, YouTube, X/Twitter, and Facebook sources',
        'Separate observable facts, third-party estimates, proxy metrics, and inferred assumptions',
        'Label competitive-intelligence conclusions with sources, confidence, limitations, and missing data sources',
      ],
      whenToUse: [
        'The user asks which competitors exist for a product, company, website, app, or category',
        'The user asks about competitor users, traffic, revenue, ARR, growth rate, market share, or development since launch',
        'The user asks how competitors grow, acquire users, or run SEO/PPC, keyword, backlink, content, social, ads, or channel strategy',
        'The user requests market landscape, competitor comparison, growth opportunities, acquisition-channel breakdown, or monetization inference',
      ],
      whenNotToUse: [
        'The user is only chatting, updating memory, maintaining preferences, or asking a lightweight question that does not need competitive, market, or growth intelligence',
        'The user asks about general news, weather, encyclopedic facts, code, deployment, files, or engineering issues',
        'The user requests code edits, commands, build debugging, or access to a real engineering workspace',
      ],
      tools: [
        'codex_agent_loop',
        'conversation',
        'reasoning',
        'current_time_context',
        'altselfs_web_search',
        'enabled_info_ops_source_agents',
        'altselfs_similarweb_api1_when_similarweb_api1_employee_enabled',
        'altselfs_semrush13_when_semrush13_employee_enabled',
        'altselfs_semrush8_when_semrush8_employee_enabled',
        'altselfs_domain_metrics_check_when_domain_metrics_check_employee_enabled',
        'future_similarweb_google_youtube_x_facebook_sources_when_enabled',
      ],
      riskLevel: 'medium',
      requiresWorkspace: false,
      requiresApprovalFor: ['third_party_api_call', 'paid_data_source_call'],
    },
    {
      id: 'codex-engineering',
      runtimeId: 'codex',
      name: 'Engineering Execution Agent',
      description:
        'A Codex runtime profile for repository inspection, code editing, shell commands, tests, builds, debugging, and deployment-related tasks.',
      visibleToRouter: false,
      capabilities: [
        'Read and analyze code repositories',
        'Edit files and produce patches',
        'Run shell commands, tests, lint, and builds',
        'Debug API, database, frontend, and deployment issues',
      ],
      whenToUse: [
        'The user explicitly asks to inspect, edit, fix, test, or deploy code',
        'The user asks about project files, APIs, database schema, build errors, or git status',
        'The task requires access to the real engineering workspace',
      ],
      whenNotToUse: [
        'Regular chat, research, strategy discussion, or tasks that do not need code file access',
        'Do not write files, run commands, or use network access without user authorization',
      ],
      tools: ['filesystem_read', 'filesystem_write_with_approval', 'shell_with_approval', 'tests', 'git'],
      riskLevel: 'high',
      requiresWorkspace: true,
      requiresApprovalFor: ['file_write', 'shell_command', 'network_access', 'deployment'],
    },
    {
      id: 'main',
      runtimeId: 'main',
      name: 'Hermes Main Agent',
      description:
        'The outer personal loop. It handles chat continuity, long-term memory, user preferences, user profile maintenance, and delegation to codex-general. It does not own business tools directly.',
      capabilities: ['Read long-term memory', 'Maintain user preferences', 'Maintain user profile', 'Handle lightweight conversation', 'Decide whether to delegate to codex-general'],
      whenToUse: [
        'The user only expresses preferences, asks to remember information, updates the user profile, or confirms role preferences',
        'The user is only greeting lightly or confirming conversation state',
      ],
      whenNotToUse: ['The task requires web access, search, complex reasoning, planning, tool use, long-running execution, or engineering capability'],
      tools: ['chat_loop', 'memory_read', 'memory_write_suggestion', 'user_profile_update', 'preference_update', 'route_to_codex_general'],
      riskLevel: 'low',
      requiresWorkspace: false,
      requiresApprovalFor: [],
    },
  ];
}

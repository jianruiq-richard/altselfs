export class AgentRegistry {
    runtimes = new Map();
    profiles = new Map();
    constructor(profiles = defaultAgentProfiles()) {
        for (const profile of profiles)
            this.profiles.set(profile.id, profile);
    }
    register(runtime) {
        this.runtimes.set(runtime.id, runtime);
    }
    get(id) {
        return this.runtimes.get(id);
    }
    list() {
        return Array.from(this.runtimes.values()).map((runtime) => ({
            id: runtime.id,
            description: runtime.description,
        }));
    }
    getProfile(id) {
        return this.profiles.get(id);
    }
    listProfiles() {
        return Array.from(this.profiles.values());
    }
    listAvailableProfiles(allowedProfileIds) {
        const allowed = allowedProfileIds?.length ? new Set(allowedProfileIds) : null;
        return this.listProfiles().filter((profile) => {
            if (profile.visibleToRouter === false)
                return false;
            if (allowed && !allowed.has(profile.id))
                return false;
            return this.runtimes.has(profile.runtimeId);
        });
    }
}
export function defaultAgentProfiles() {
    return [
        {
            id: 'codex-general',
            runtimeId: 'codex',
            name: '通用讨论与研究 Agent',
            description: 'The single execution and capability hub under Hermes. It handles reasoning, research, web search, tool use, future channel agents, and task orchestration. Local workspace, shell, files, and patching are disabled.',
            capabilities: [
                '承接 Hermes 下放的复杂讨论、分析与推理',
                '根据可用联网工具获取外部信息',
                '统筹后续接入的秘书晨报、微信、小红书、邮箱、飞书等工具或子 Agent',
                '整理资料、比较方案、提出决策建议',
                '在 Codex agent loop 内维护一轮复杂任务的上下文',
            ],
            whenToUse: [
                '用户想讨论问题、研究外部信息、整理资料或获得建议',
                '用户请求联网搜索、行业资讯、今日信息、工具调用或子 Agent 能力',
                '用户请求计划拆解、方案比较、复杂判断或行动建议',
                '任务需要多步推理或工具调用，但不需要修改真实代码仓库',
            ],
            whenNotToUse: [
                '用户只是要求 Hermes 记住偏好、更新用户画像，或做非常轻量的寒暄确认',
                '用户明确要求修改代码、查看本地仓库、运行命令、调试构建',
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
            name: '竞品情报分析 Agent',
            description: 'A specialized Codex profile for competitive intelligence, growth-channel analysis, SEO/PPC research, market positioning, user/traffic proxy analysis, revenue estimation, and evidence-based competitor synthesis. It uses enabled information-source agents such as Semrush, Similarweb, Google, YouTube, X/Twitter, Facebook, WeChat, Xiaohongshu, Gmail, and Feishu when available.',
            capabilities: [
                '识别直接竞品、间接竞品、SEO/PPC 竞品和渠道竞品',
                '围绕用户量、访问量、营收、增速和获客方式组织证据链',
                '优先调用已启用的信息源员工，例如 Similarweb API1、Semrush13、Semrush8、Domain Metrics Check、后续 Google、YouTube、X/Twitter、Facebook 等',
                '区分可观测事实、第三方估算、代理指标和推论假设',
                '为竞品情报结论标注来源、置信度、限制和仍需补充的数据源',
            ],
            whenToUse: [
                '用户询问某个产品、公司、网站、应用或品类有哪些竞品',
                '用户询问竞品用户量、访问量、营收、ARR、增长速度、市场份额或上线以来的发展',
                '用户询问竞品如何增长获客、SEO/PPC/关键词/外链/内容/社媒/广告/渠道策略',
                '用户请求市场竞争格局、竞品对比、增长机会、获客渠道拆解或商业化推断',
            ],
            whenNotToUse: [
                '用户只是普通闲聊、记忆更新、个人偏好维护或无需竞品/市场/增长情报的轻量问题',
                '用户只是问一般新闻、天气、百科、代码、部署、文件或工程问题',
                '用户请求修改代码、运行命令、调试构建或访问真实工程 workspace',
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
            name: '工程执行 Agent',
            description: 'A Codex runtime profile for repository inspection, code editing, shell commands, tests, builds, debugging, and deployment-related tasks.',
            visibleToRouter: false,
            capabilities: [
                '阅读和分析代码仓库',
                '修改文件并生成 patch',
                '执行 shell 命令、测试、lint、build',
                '调试 API、数据库、前端和部署问题',
            ],
            whenToUse: [
                '用户明确要求查看、修改、修复、测试或部署代码',
                '用户询问项目文件、API、数据库 schema、构建错误或 git 状态',
                '任务需要访问真实工程 workspace',
            ],
            whenNotToUse: [
                '普通聊天、研究、战略讨论或不需要访问代码文件的任务',
                '没有用户授权时不要执行写文件、命令或网络操作',
            ],
            tools: ['filesystem_read', 'filesystem_write_with_approval', 'shell_with_approval', 'tests', 'git'],
            riskLevel: 'high',
            requiresWorkspace: true,
            requiresApprovalFor: ['file_write', 'shell_command', 'network_access', 'deployment'],
        },
        {
            id: 'main',
            runtimeId: 'main',
            name: 'Hermes 主 Agent',
            description: 'The outer personal loop. It handles chat continuity, long-term memory, user preferences, user profile maintenance, and delegation to codex-general. It does not own business tools directly.',
            capabilities: ['读取长期记忆', '维护用户偏好', '维护用户画像', '轻量对话承接', '决定是否下放给 codex-general'],
            whenToUse: [
                '用户只是表达偏好、要求记住信息、更新用户画像或确认身份偏好',
                '用户只是轻量寒暄或对会话状态做简单确认',
            ],
            whenNotToUse: ['任务需要联网、搜索、复杂推理、计划拆解、工具调用、长任务执行或工程能力'],
            tools: ['chat_loop', 'memory_read', 'memory_write_suggestion', 'user_profile_update', 'preference_update', 'route_to_codex_general'],
            riskLevel: 'low',
            requiresWorkspace: false,
            requiresApprovalFor: [],
        },
    ];
}

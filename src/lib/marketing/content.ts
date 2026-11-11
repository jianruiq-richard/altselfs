export type GuideSection = { id: string; title: string; paragraphs?: string[]; steps?: { title: string; body: string }[]; bullets?: string[] };
export type Guide = { slug: string; title: string; seoTitle: string; description: string; intro: string; sections: GuideSection[]; related: string[] };

export const guides: Guide[] = [
  {
    slug: 'agent-context-handoff', title: 'Switch agents. Keep context.',
    seoTitle: 'AI agent context handoff in Minaco',
    description: 'Learn how Minaco gathers visible conversation context and hands it to another native AI agent in the same workspace, with clear transfer boundaries.',
    intro: 'A different agent can take the next step without asking you to rebuild the whole brief. Minaco keeps the conversation together and passes relevant working context into the next native session.',
    sections: [
      { id: 'what-moves', title: 'What moves with you', paragraphs: ['Minaco gathers visible messages and tool activity from the conversation and prepares context for the next agent. The same workspace keeps project files available, while the conversation remains in one place.', 'The model-facing context has a size limit and favors recent work when a conversation is long. The visible conversation history and the context delivered to a model are not identical. Keep important decisions in a project file when you need a durable reference.'] },
      { id: 'handoff', title: 'Make the handoff', steps: [
        { title: 'Finish the current turn', body: 'Wait for the agent to finish and resolve any pending approval. A running tool or unanswered approval needs attention before you switch.' },
        { title: 'Choose the next agent', body: 'Use the Agent selector in the existing conversation. Choose an installed, ready agent and a model that is available for its account mode.' },
        { title: 'Give it the next step', body: 'Send a clear instruction, such as “Use the agreed plan to implement the first screen.” Minaco attaches the prepared context to the new agent’s first turn.' },
        { title: 'Review what it understood', body: 'For a complex task, ask the new agent to state the goal, important constraints and next action before it changes files.' },
      ] },
      { id: 'boundaries', title: 'What stays with the agent', bullets: ['Provider sign-ins, credentials and account permissions.', 'Private model reasoning and internal runtime state.', 'Running processes, pending approvals and native plugin internals.', 'Files outside the shared workspace and information that was never part of the visible conversation.'], paragraphs: ['The next agent uses its own tools, settings and approval policy. Switching does not convert one vendor’s native session into another vendor’s session.'] },
      { id: 'working-brief', title: 'Leave a useful working brief', paragraphs: ['Before a substantial handoff, ask the current agent to record the objective, decisions, constraints, files changed and remaining work. A short brief gives both you and the next agent an explicit checkpoint.', 'You might ask: “Save the decisions and next steps in the project notes, including anything still uncertain. The next agent will continue the implementation.”'] },
      { id: 'troubleshooting', title: 'If a switch is unavailable', paragraphs: ['Check for a running turn or pending approval first. Then confirm that the target agent is installed, ready and has an available model or connected account.', 'If preparing the target session fails, Minaco keeps the source agent active. Resolve the target setup before trying again. A failed start should not require you to erase the conversation.'] },
    ], related: ['claude-code-and-codex', 'one-subscription-multiple-agents'],
  },
  {
    slug: 'claude-code-and-codex', title: 'Claude Code + Codex.',
    seoTitle: 'Use Claude Code and Codex together in Minaco',
    description: 'Use Claude Code and Codex in one Minaco conversation. Plan a task, hand over its context, continue in the same workspace, and review the result.',
    intro: 'Use both agents around the same project. Choose the agent for each stage, then hand over the visible context instead of copying the conversation between separate windows.',
    sections: [
      { id: 'setup', title: 'Get both agents ready', paragraphs: ['Install Minaco on an Apple silicon Mac and connect your Minaco account. Open the Agent settings to install and prepare Claude Code and Codex.', 'For each agent, choose an available Minaco-credit model or a supported personal-account mode. An account connected to one agent does not automatically authorize the other.'] },
      { id: 'workflow', title: 'Try one continuous project', paragraphs: ['The following is an example workflow, not a benchmark or a claim that one agent is always better at a particular stage. Reverse the order whenever it suits your work.'], steps: [
        { title: 'Start with a concrete brief', body: 'Open a workspace with Claude Code. Ask for a plan for a small website change: the affected files, acceptance criteria and a sensible way to verify it.' },
        { title: 'Agree on the plan', body: 'Review the proposal and record the decisions in the conversation or a project file. Resolve any questions before asking another agent to continue.' },
        { title: 'Switch to Codex', body: 'When the current turn has finished, choose Codex in the Agent selector. Keep the same conversation and workspace.' },
        { title: 'Continue the implementation', body: 'Ask Codex to implement the agreed change. Minaco passes the relevant conversation context into the new native session; the workspace files remain available.' },
        { title: 'Review the result', body: 'Ask for the checks performed and any remaining limitations. You can switch back for another review once the turn and approvals are complete.' },
      ] },
      { id: 'context', title: 'Make the next instruction count', paragraphs: ['A good continuation names the next action and the acceptance condition: “Implement the approved pricing toggle. Keep the current layout and verify the annual total.”', 'Refer to actual files when the details matter. A file-based specification is easier to check than assuming every earlier sentence is present in the next model’s context.'] },
      { id: 'billing', title: 'Know which account is funding the turn', paragraphs: ['Supported Minaco-credit turns draw from your Minaco balance. Personal-account turns use the connected provider’s own subscription, quotas and billing.', 'The models, tools and permissions available in Claude Code and Codex can differ. Check the selected agent and account mode before starting a costly or important task.'] },
      { id: 'limits', title: 'A shared task, native boundaries', paragraphs: ['Minaco carries visible working context, not hidden reasoning, credentials or live processes. The next agent may need a fresh approval or its own app connection.', 'If you need a complete description of the transfer boundary, read the context handoff guide before relying on a long or sensitive conversation.'] },
    ], related: ['agent-context-handoff', 'one-subscription-multiple-agents'],
  },
  {
    slug: 'one-subscription-multiple-agents', title: 'One subscription. Clear costs.',
    seoTitle: 'One subscription for multiple AI agents: Minaco Credits explained',
    description: 'Understand Minaco-funded agent usage, shared Credits, model rates and personal provider accounts before choosing a Minaco subscription.',
    intro: 'A Minaco plan gives you one shared Credit balance for supported funded usage across agents. Here is how that differs from connecting subscriptions you already have.',
    sections: [
      { id: 'included', title: 'What your plan covers', paragraphs: ['Your plan sets the included Credit allowance, supported model tiers and task limits. Eligible Minaco-funded turns use that shared balance rather than requiring a separate Minaco plan for each agent.', 'The agent directory and pricing page show the published catalog. An agent appearing in the directory does not mean every model or every native subscription feature is included.'] },
      { id: 'modes', title: 'Choose how a turn is funded', steps: [
        { title: 'Minaco-credit mode', body: 'Choose a funded model available to your plan and agent. Minaco records the usage and deducts Credits according to the applicable rate.' },
        { title: 'Personal-account mode', body: 'Connect an account supported by that agent. The provider’s separate subscription, quotas and billing apply. This does not turn that subscription into a shared entitlement for every agent.' },
      ], paragraphs: ['Connecting an external app can involve a separate service subscription or usage charge. Review the app and provider terms for any service you choose to connect.'] },
      { id: 'rates', title: 'Read a model rate', paragraphs: ['Rates are shown in Minaco Credits per one million tokens. Input is new text and context sent to a model. Cached input is reused context charged at the published cached rate. Output includes generated tokens and any reasoning tokens billed by the route.', 'A longer conversation or a larger context handoff can increase the next turn’s input. The same prompt can therefore cost different amounts with different models and amounts of context.', 'The published conversion is 1,000 Credits per US dollar. Your actual usage follows the model rate and the tokens billed, not a fixed price per message.'] },
      { id: 'plans', title: 'Select a plan for your workload', paragraphs: ['Compare the current monthly or annual price, included Credits, model tiers and task limits on the pricing page. Annual billing shows the annual charge and allowance; check those totals before paying.', 'Do not treat the number of concurrent or scheduled tasks as an unlimited usage allowance. Completed funded work still consumes Credits.'] },
      { id: 'balance', title: 'When the balance runs low', paragraphs: ['Review recent usage in My account. You can choose an available Credit pack or a different plan when you need more funded usage.', 'Purchased Credit packs remain on your account when you change plans. Personal provider accounts continue to follow their own limits. Check the checkout terms for the exact purchase you are making.'] },
      { id: 'before-starting', title: 'Before starting a large task', bullets: ['Check the agent, selected model and funding mode.', 'Look at the input, cached-input and output rates.', 'Keep the working context relevant to the task.', 'Review usage after a small representative task before scaling up.'] },
    ], related: ['agent-context-handoff', 'claude-code-and-codex'],
  },
];

export const featuredAgents = [
  { slug: 'claude-code', id: 'claude', name: 'Claude Code', vendor: 'Anthropic', title: 'Claude Code. In your workspace.', description: 'Use native Claude Code in Minaco on your Mac. Keep your project and conversation together, choose an available account mode, and hand the work to another agent.', lead: 'Bring Claude Code into a workspace that can continue with your next agent. Keep its native way of working alongside your project files and shared conversation.', prompt: 'Read this project and propose the smallest useful change. Explain your plan and what you will verify before editing files.' },
  { slug: 'codex', id: 'codex', name: 'Codex', vendor: 'OpenAI', title: 'Codex. Part of the same work.', description: 'Use native Codex in Minaco on your Mac. Start a project, work with your files, and continue a conversation handed over from another agent.', lead: 'Work with Codex in the same place as your other agents. Continue an existing brief, review the files and move the project forward.', prompt: 'Continue from the agreed plan. First summarize the next change and its acceptance criteria, then implement it and report the checks you ran.' },
] as const;

export const marketingPaths = ['/agents', ...featuredAgents.map(a => `/agents/${a.slug}`), '/guides', ...guides.map(g => `/guides/${g.slug}`)];

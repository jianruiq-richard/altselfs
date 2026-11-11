import type { MinacoProductCatalog } from '../minaco-product-catalog';
import { landingTemplate } from '../landing/template';
import { renderLandingAccount, type LandingAccount } from '../landing/account';
import { landingGoogleTag } from '../analytics/google-tag';
import { clarityScriptTag } from '../analytics/clarity';
import { guides, featuredAgents, type Guide } from './content';
import { modelProfiles, reviewedAt } from './profiles';
import { canonicalOrigin, escapeHtml as e, jsonLd, pageMetadata } from './seo';

const arrow = '<svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';
const iconSymbols = landingTemplate.match(/<svg aria-hidden="true"[\s\S]*?<\/svg>/)![0];
const baseHeader = landingTemplate.match(/<header class="sitehead">[\s\S]*?<\/header>/)![0];
const footer = landingTemplate.match(/<footer class="footer">[\s\S]*?<\/footer>/)![0].replaceAll('href="#home"', 'href="/"');

export function shell(path: string, title: string, description: string, content: string, account: LandingAccount | null, schema?: unknown) {
  const header = baseHeader.replaceAll('href="#home"', 'href="/"').replaceAll('href="#demo"', 'href="/#demo"').replaceAll('href="#pricing"', 'href="/pricing"')
    .replace('__SERVER_ACCOUNT_ACTION__', () => renderLandingAccount(account))
    .replace('__SERVER_MOBILE_ACCOUNT__', account ? '<a class="mobilelogin" href="/account">My account</a>' : '<a class="mobilelogin" href="/sign-in?redirect_url=/account">Log in</a>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">${pageMetadata(path, title, description)}<link rel="icon" href="/brand/minaco/png/minaco-favicon-96.png"><link rel="stylesheet" href="/landing/marketing.css"><link rel="stylesheet" href="/landing/resources.css">${schema ? jsonLd(schema) : ''}${clarityScriptTag(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID)}${landingGoogleTag()}</head><body class="resource-page">${iconSymbols}<a class="skip" href="#main">Skip to content</a>${header}<main id="main" class="resource-main">${content}</main>${footer}<script src="/landing/resources.js" defer></script></body></html>`;
}

export function crumbs(items: { name: string; path?: string }[]) {
  return `<nav class="resource-crumbs" aria-label="Breadcrumb"><a href="/">Minaco</a>${items.map(item => `<span aria-hidden="true">/</span>${item.path ? `<a href="${item.path}">${e(item.name)}</a>` : `<span aria-current="page">${e(item.name)}</span>`}`).join('')}</nav>`;
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: 'Minaco', path: '/' }, ...items].map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: canonicalOrigin + item.path })) };
}

function readingLinks(slugs: string[]) {
  return `<section class="resource-related wrap"><h2>Keep going.</h2><div>${slugs.map(slug => {
    const guide = guides.find(g => g.slug === slug)!;
    return `<a href="/guides/${guide.slug}"><span><strong>${e(guide.title)}</strong><small>${e(guide.description)}</small></span>${arrow}</a>`;
  }).join('')}</div></section>`;
}

export function closing(title = 'Bring your next project.') {
  return `<section class="resource-closing wrap"><div><h2>${title}</h2><p>Your agents. Your workspace. One place to continue.</p></div><a class="btn primary" href="/download">Download for Mac ${arrow}</a></section>`;
}

export function renderAgentDirectory(catalog: MinacoProductCatalog, account: LandingAccount | null = null) {
  const path = '/agents';
  const rows = catalog.agents.map(agent => {
    const feature = featuredAgents.find(a => a.id === agent.id);
    const funded = catalog.models.filter(m => m.engines.includes(agent.id));
    return `<div class="resource-agent-directory-row"><div><h2>${feature ? `<a href="/agents/${feature.slug}">${e(agent.name)} ${arrow}</a>` : e(agent.name)}</h2><p>${e(agent.vendor)}</p></div><div><span>${funded.length ? 'Minaco Credits available' : 'No funded model currently listed'}</span><small>${agent.status === 'experimental' ? 'Experimental integration' : 'Available integration'}</small></div><div>${feature ? `<a class="text-link" href="/agents/${feature.slug}">Explore ${e(agent.name)} ${arrow}</a>` : '<a class="text-link" href="/download">Set up in Minaco '+arrow+'</a>'}</div></div>`;
  }).join('');
  return shell(path, 'Native AI Agents for Mac | Minaco', 'Explore the native AI agents published for Minaco. See funded model availability, learn how to get started, and continue your work between agents.', `
    <section class="resource-hero wrap">${crumbs([{ name: 'Agents' }])}<h1>Your agents.<br>One workspace.</h1><p>Choose the agent for the work in front of you. Keep your project and conversation together when it is time to switch.</p><div class="actions"><a class="btn primary" href="/download">Download for Mac ${arrow}</a><a class="text-link" href="/guides/agent-context-handoff">How context handoff works ${arrow}</a></div></section>
    <section class="resource-feature wrap"><div><h2>Native agents.<br>Shared momentum.</h2><p>Each agent keeps its own execution loop, tools and account boundaries. Minaco brings the workspace and visible working context together.</p><a class="text-link" href="/guides/claude-code-and-codex">Try Claude Code with Codex ${arrow}</a></div><figure><img src="/landing/workflow-preview.webp" alt="Minaco conversation interface with a project workflow and agent selection" width="1200" height="760"><figcaption>An illustrative workflow in the Minaco interface.</figcaption></figure></section>
    <section class="resource-agent-directory wrap" aria-labelledby="catalog-heading"><div class="resource-section-head"><h2 id="catalog-heading">Explore the catalog.</h2><p>Published ${e(catalog.generatedAt.slice(0, 10))}. Installation and account setup happen in the app.</p></div>${rows || '<p>The catalog is temporarily unavailable. Open Minaco to check current agent availability.</p>'}<p class="resource-note">Published support and funded model access are different. Availability depends on the agent, model, account mode and plan. Experimental integrations may have limitations. <a href="/guides/one-subscription-multiple-agents">Understand your subscription.</a></p></section>
    ${readingLinks(['agent-context-handoff', 'one-subscription-multiple-agents'])}${closing()}`, account,
    [breadcrumbs([{ name: 'Agents', path }]), { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Minaco native agent catalog', itemListElement: catalog.agents.map((agent, i) => ({ '@type': 'ListItem', position: i + 1, name: agent.name })) }]);
}

export function renderAgentPage(slug: string, catalog: MinacoProductCatalog, account: LandingAccount | null = null) {
  const agent = featuredAgents.find(a => a.slug === slug);
  if (!agent) return null;
  const path = `/agents/${agent.slug}`;
  const published = catalog.agents.find(a => a.id === agent.id);
  const fundedModels = catalog.models.filter(m => m.engines.includes(agent.id));
  const modelNames = fundedModels.map(m => m.label);
  return shell(path, `${agent.name} in Minaco for Mac | Native AI Agent Workspace`, agent.description, `
    <section class="resource-hero wrap">${crumbs([{ name: 'Agents', path: '/agents' }, { name: agent.name }])}<h1>${e(agent.name)}.<br>Same workspace.</h1><p>${e(agent.lead)}</p><div class="actions"><a class="btn primary" href="/download">Get Minaco for Mac ${arrow}</a><a class="text-link" href="#models">Models and accounts ${arrow}</a></div></section>
    <section class="resource-feature wrap"><div><h2>Keep the agent.<br>Continue the work.</h2><p>Minaco runs the native agent and keeps the project around it. When another agent takes over, relevant visible context travels with the conversation.</p><p>The next agent uses its own permissions and settings. Your provider credentials and private model state stay separate.</p></div><figure><img src="/landing/workflow-preview.webp" alt="Example of the shared conversation and project workspace in Minaco" width="1200" height="760"><figcaption>The shared Minaco workspace; example content shown.</figcaption></figure></section>
    <div class="resource-article wrap"><aside><nav aria-label="On this page"><a href="#overview">About the agent</a><a href="#setup">Get started</a><a href="#first-task">First task</a><a href="#models">Models and accounts</a><a href="#handoff">Switch agents</a></nav></aside><article>
      <section id="overview"><h2>What is ${e(agent.name)}?</h2><p>${e(agent.overview)}</p><h3>A workflow to try</h3><p>${e(agent.workflow)}</p><h3>Know the boundary</h3><p>${e(agent.boundary)}</p></section>
      <section id="setup"><h2>Get started.</h2><ol class="resource-steps"><li><h3>Install Minaco</h3><p>Download the signed app for an Apple silicon Mac running macOS 13 or later, move it to Applications, and connect your Minaco account.</p></li><li><h3>Prepare ${e(agent.name)}</h3><p>Open the Agent settings, install ${e(agent.name)} if needed, and complete the setup shown in the app. The current catalog ${published ? `lists this integration as ${e(published.status)}` : 'does not list this integration; check in the app before proceeding'}.</p></li><li><h3>Choose an account mode</h3><p>Select a Minaco-credit model available to your plan, or connect a supported personal account. The available choices are specific to ${e(agent.name)}.</p></li><li><h3>Open your workspace</h3><p>Choose the project folder, create a conversation and send a focused task. Review any approval requests before the agent acts.</p></li></ol></section>
      <section id="first-task"><h2>Start with a clear brief.</h2><p>Give the agent a concrete goal and ask it to check the workspace before changing it. For example:</p><blockquote>${e(agent.prompt)}</blockquote><p>Review the plan and result against your own acceptance criteria. The agent’s available tools and connected services determine what it can do.</p></section>
      <section id="models"><h2>Models and accounts.</h2><p>${modelNames.length ? `Currently published funded models: ${fundedModels.map(m => { const profile = modelProfiles.find(p => p.id === m.model && p.provider === m.provider); return profile ? `<a href="/models/${profile.slug}">${e(m.label)}</a>` : e(m.label); }).join(', ')}.` : 'No funded models are currently listed for this agent. Check the available account modes inside Minaco.'}</p><p>Model access depends on your plan and current availability. Minaco-credit turns use your shared balance. Personal-account turns follow the provider’s own subscription, quotas and billing.</p><a class="text-link" href="/pricing#model-rates">See current model rates ${arrow}</a></section>
      <section id="handoff"><h2>Pass the work forward.</h2><p>Finish the current turn, resolve pending approvals and choose a ready agent in the conversation’s Agent selector. Minaco prepares the visible working context for its next turn.</p><p>A long history can be shortened in the context sent to the model. Save important decisions in a project file and ask the next agent to confirm its understanding.</p><a class="text-link" href="/guides/agent-context-handoff">Read the handoff guide ${arrow}</a></section>
      <section id="sources"><h2>Read the source.</h2><p><a href="${e(agent.source.url)}" rel="external">${e(agent.source.title)}</a> — editorial facts checked ${reviewedAt}. The workflow examples on this page are Minaco suggestions, not vendor benchmarks.</p></section><p class="resource-note">${e(agent.name)} is developed by ${e(agent.vendor)}. Minaco is an independent workspace, not the vendor’s official desktop application. Catalog checked ${e(catalog.generatedAt.slice(0, 10))}.</p>
    </article></div>${readingLinks(['claude-code-and-codex', 'one-subscription-multiple-agents'])}${closing()}`, account, breadcrumbs([{ name: 'Agents', path: '/agents' }, { name: agent.name, path }]));
}

export function renderGuideIndex(account: LandingAccount | null = null) {
  return shell('/guides', 'Guides to AI Agent Workflows & Credits | Minaco', 'Practical Minaco guides for agent context handoff, using Claude Code with Codex, and understanding one subscription across multiple AI agents.', `
    <section class="resource-hero wrap">${crumbs([{ name: 'Guides' }])}<h1>A better way<br>to keep going.</h1><p>Practical guides for your first project, your next agent and the work in between.</p></section>
    <section class="guide-index wrap" aria-label="Minaco guides">${guides.map((guide, i) => `<a class="guide-index-row" href="/guides/${guide.slug}"><div><span class="guide-category">${['Working context', 'Agent workflows', 'Subscriptions & usage'][i]}</span><h2>${e(guide.title)}</h2></div><p>${e(guide.description)}</p><span class="guide-open">Read guide ${arrow}</span></a>`).join('')}</section>
    <section class="resource-start wrap"><h2>New to Minaco?</h2><p>Start with the app, choose an agent and bring a small project. You can add more agents as your work grows.</p><div class="actions"><a class="btn primary" href="/download">Download for Mac ${arrow}</a><a class="text-link" href="/agents">Explore the agents ${arrow}</a></div></section>${closing()}`, account, breadcrumbs([{ name: 'Guides', path: '/guides' }]));
}

export function renderGuide(slug: string, account: LandingAccount | null = null) {
  const guide: Guide | undefined = guides.find(g => g.slug === slug);
  if (!guide) return null;
  const path = `/guides/${guide.slug}`;
  return shell(path, `${guide.seoTitle} | Minaco`, guide.description, `
    <section class="resource-hero resource-guide-hero wrap">${crumbs([{ name: 'Guides', path: '/guides' }, { name: guide.title }])}<h1>${e(guide.title)}</h1><p>${e(guide.intro)}</p><div class="resource-byline">By the Minaco team <span>Product guide</span></div></section>
    <div class="resource-article wrap"><aside><nav aria-label="On this page">${guide.sections.map(section => `<a href="#${section.id}">${e(section.title)}</a>`).join('')}</nav><a class="text-link" href="/download">Get Minaco ${arrow}</a></aside><article>${guide.sections.map(section => `<section id="${section.id}"><h2>${e(section.title)}</h2>${(section.paragraphs || []).map(p => `<p>${e(p)}</p>`).join('')}${section.steps ? `<ol class="resource-steps">${section.steps.map(step => `<li><h3>${e(step.title)}</h3><p>${e(step.body)}</p></li>`).join('')}</ol>` : ''}${section.bullets ? `<ul>${section.bullets.map(b => `<li>${e(b)}</li>`).join('')}</ul>` : ''}</section>`).join('')}
    <div class="resource-reading-end"><p>Ready to use this in your own project?</p><a class="btn primary" href="/download">Download for Mac ${arrow}</a><a class="text-link" href="/pricing">Plans and current rates ${arrow}</a></div></article></div>${readingLinks(guide.related)}`, account, [breadcrumbs([{ name: 'Guides', path: '/guides' }, { name: guide.title, path }]), { '@context': 'https://schema.org', '@type': 'Article', headline: guide.title, description: guide.description, mainEntityOfPage: canonicalOrigin + path, author: { '@type': 'Organization', name: 'Minaco', url: canonicalOrigin }, publisher: { '@type': 'Organization', name: 'Minaco', url: canonicalOrigin }, inLanguage: 'en' }]);
}

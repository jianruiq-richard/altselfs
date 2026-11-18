import { formatCacheWriteRate, modelRateRows } from '../model-rate-display';
import { landingGoogleTag } from '../analytics/google-tag';
import { clarityScriptTag } from '../analytics/clarity';
import type { MinacoProductCatalog } from '../minaco-product-catalog';
import { landingTemplate } from './template';
import { renderLandingAccount, type LandingAccount } from './account';
import { homepageStructuredData } from '../marketing/seo';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderLanding(source: MinacoProductCatalog, clarityProjectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID, account: LandingAccount | null = null) {
  const catalog = {...source, models: source.models.flatMap(modelRateRows).map(m => m.unit === 'microUSD' ? {...m, input:m.input/1000,cachedInput:m.cachedInput/1000,output:m.output/1000,...(m.cacheWrite === undefined ? {} : {cacheWrite:m.cacheWrite/1000}),...(m.cacheWrite1h === undefined ? {} : {cacheWrite1h:m.cacheWrite1h/1000}),unit:'credits' as const} : m)};
  const names = Object.fromEntries(catalog.agents.map(a => [a.id,a.name]));
  const number = (n:number) => n.toLocaleString('en-US',{maximumFractionDigits:3});
  const rows = catalog.models.slice(0,8).map(m => `<tr><td><strong>${escape(m.label)}</strong><small>${escape(m.model)}</small>${m.pricingNote ? `<small>${escape(m.pricingNote)}</small>` : ''}</td><td>${escape(m.engines.map(e=>names[e]||e).join(', '))}</td><td>${number(m.input)}</td><td>${number(m.cachedInput)}</td><td>${formatCacheWriteRate(m)}</td><td>${number(m.output)}</td></tr>`).join('');
  const plans = catalog.plans.filter(p=>p.key!=='FREE').map(p=>`<article class="plan ${p.highlighted?'featured':''}"><h3>${escape(p.name)}</h3><p class="plan-intro">${escape(p.description)}</p><div class="price">$${p.priceUsd}<span> / month</span></div><p class="billing-line">Billed monthly in USD</p><div class="allowance"><strong>${number(p.monthlyCredits)} credits / month</strong></div><ul><li>${p.concurrentTasks} concurrent tasks</li><li>${p.scheduledTasks} scheduled tasks</li><li>${escape(p.modelTiers.join(' + '))} model access</li></ul><a class="btn" href="/account?view=plan&amp;plan=${escape(p.key)}&amp;cycle=monthly">Choose ${escape(p.name)}</a></article>`).join('');
  return landingTemplate.replace('__SERVER_ACCOUNT_ACTION__', () => renderLandingAccount(account)).replace('__SERVER_MOBILE_ACCOUNT__', () => account ? '<a class="mobilelogin" href="/account">My account</a>' : '<a class="mobilelogin" href="/sign-in?redirect_url=/account">Log in</a>')
    .replace('Use Claude Code, Codex, and other native AI agents in one workspace on your Mac. Minaco brings together the context of your work and hands it to the next agent.', 'Use Claude Code, Codex, DeepSeek, Kimi, GLM, and other native AI agents in one Mac workspace. Minaco carries your work context between agents.')
    .replace('Use Claude Code, Codex, and other native AI agents in one Mac workspace.', 'Use Claude Code, Codex, DeepSeek, Kimi, GLM, and other native AI agents in one Mac workspace.')
    .replace('<a href="#demo">Workflows</a>', '')
    .replaceAll('<a href="/guides">Guides</a>', '<a href="/guidance">Guidance</a>')
    .replaceAll('href="/guides/agent-context-handoff"', 'href="/guidance#switch-agents"')
    .replaceAll('href="/guides/claude-code-and-codex"', 'href="/guidance#switch-agents"')
    .replaceAll('href="/guides/one-subscription-multiple-agents"', 'href="/guidance#usage"')
    .replace('href="#pricing">Pricing</a>', 'href="/pricing">Pricing</a>')
    .replaceAll('href="/api/download"', 'href="/download"')
    .replace('macOS · Apple silicon', 'macOS 13+ · Apple silicon and Intel')
    .replace('Minaco is available for Apple silicon Macs running macOS 13 or later. Windows, Linux and Intel builds are not currently offered.', 'Minaco is available for Apple silicon and Intel Macs running macOS 13 or later. Windows and Linux builds are not currently offered.')
    .replace('Minaco brings together the context of your work and hands it to the next agent.', 'Minaco Desktop brings together the context of your work and hands it to the next agent.')
    .replace('Download for Mac <svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>', 'Download Minaco Desktop for Mac <svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>')
    .replace('Download for Mac <svg class="icon"><use href="#i-download"/></svg>', 'Download Minaco Desktop for Mac <svg class="icon"><use href="#i-download"/></svg>')
    .replace('© 2026 Minaco. Think with you. Act for you.', '© 2026 Astromar Limited. Minaco Desktop · Think with you. Act for you.')
    .replace('</head>', () => homepageStructuredData(catalog) + clarityScriptTag(clarityProjectId) + landingGoogleTag() + '</head>').replace('__SERVER_RATE_ROWS__',rows).replace('__SERVER_PLANS__',plans).replace('__CATALOG_DATE__',escape(catalog.generatedAt.slice(0,10))).replace('__CATALOG_JSON__',()=>JSON.stringify(catalog).replace(/</g,'\\u003c'));
}

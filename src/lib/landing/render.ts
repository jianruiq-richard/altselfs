import type { MinacoProductCatalog } from '../minaco-product-catalog';
import { landingTemplate } from './template';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderLanding(source: MinacoProductCatalog) {
  const catalog = {...source, models: source.models.map(m => m.unit === 'microUSD' ? {...m, input:m.input/1000,cachedInput:m.cachedInput/1000,output:m.output/1000,unit:'credits' as const} : m)};
  const names = Object.fromEntries(catalog.agents.map(a => [a.id,a.name]));
  const number = (n:number) => n.toLocaleString('en-US',{maximumFractionDigits:3});
  const rows = catalog.models.slice(0,8).map(m => `<tr><td><strong>${escape(m.label)}</strong><small>${escape(m.model)}</small></td><td>${escape(m.engines.map(e=>names[e]||e).join(', '))}</td><td>${number(m.input)}</td><td>${number(m.cachedInput)}</td><td>${number(m.output)}</td></tr>`).join('');
  const plans = catalog.plans.filter(p=>p.key!=='FREE').map(p=>`<article class="plan ${p.highlighted?'featured':''}"><h3>${escape(p.name)}</h3><p class="plan-intro">${escape(p.description)}</p><div class="price">$${p.priceUsd}<span> / month</span></div><p class="billing-line">Billed monthly in USD</p><div class="allowance"><strong>${number(p.monthlyCredits)} credits / month</strong></div><ul><li>${p.concurrentTasks} concurrent tasks</li><li>${p.scheduledTasks} scheduled tasks</li><li>${escape(p.modelTiers.join(' + '))} model access</li></ul><a class="btn" href="/account?view=plan&amp;plan=${escape(p.key)}&amp;cycle=monthly">Choose ${escape(p.name)}</a></article>`).join('');
  return landingTemplate.replace('__SERVER_RATE_ROWS__',rows).replace('__SERVER_PLANS__',plans).replace('__CATALOG_DATE__',escape(catalog.generatedAt.slice(0,10))).replace('__CATALOG_JSON__',()=>JSON.stringify(catalog).replace(/</g,'\\u003c'));
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, ExternalLink } from 'lucide-react';
import { DiscordLogo } from '@/components/discord-logo';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import { productBrand } from '@/lib/brand';
import type { MinacoProductCatalog, PublicAgent, PublicModelRate } from '@/lib/minaco-product-catalog';
import styles from './minaco-desktop-landing-page.module.css';

type Props = { catalog: MinacoProductCatalog };

const stages = [
  { title: 'Download the workspace', detail: 'Install the signed macOS app, then sign in with the same Minaco account you already use on the web.', view: 'download' },
  { title: 'Choose the right Agent', detail: 'Install an Agent when you need it, or switch to one that is already ready. Other Agents stay available while setup runs.', view: 'agents' },
  { title: 'Keep the work moving', detail: 'Minaco carries a deliberate summary of the visible conversation and tool activity into the next Agent. Credentials never cross.', view: 'handoff' },
  { title: 'See one honest bill', detail: 'Minaco-credit turns show the model, input, cached input, output, and credits together under the same account.', view: 'usage' },
] as const;

const faqs = [
  ['One subscription', 'Do I need a separate Minaco subscription for every Agent?', 'No. Minaco credits and your Minaco plan are shared by supported Minaco-credit Agents and the browser-based Minaco Agent. Personal-account modes use that provider account instead.'],
  ['Native Agents', 'Does Minaco replace the Agent itself?', 'No. Minaco hosts the native Agent and its real workflow. Availability, authorization, tools, and model controls remain specific to that Agent.'],
  ['Context', 'What moves when I switch Agents?', 'Minaco summarizes visible messages and tool activity for the next turn. Provider credentials, hidden state, and account tokens are never transferred.'],
  ['Files', 'Where do projects and conversations live?', 'The Desktop workspace keeps conversation history and native Agent state locally. Cloud services authenticate, meter supported usage, and forward model requests.'],
  ['Web Agent', 'What happened to the original Minaco Agent?', 'It remains available as a browser-based market-intelligence Agent and uses the same Minaco account, credits, and subscription.'],
] as const;

export function MinacoDesktopLandingPage({ catalog }: Props) {
  const agents = catalog.agents;
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [stage, setStage] = useState(0);
  const [faq, setFaq] = useState(0);
  const [workspace, setWorkspace] = useState('Launch research');
  const activeAgent = agents.find((agent) => agent.id === agentId) || agents[0];
  const paidPlans = catalog.plans.filter((plan) => plan.key !== 'FREE');
  const featuredModels = useMemo(() => distinctModels(catalog.models).slice(0, 12), [catalog.models]);
  const downloadUrl = catalog.release?.url || 'https://desktop.minaco.ai/#download';
  const releaseText = catalog.release
    ? `Minaco ${catalog.release.version} · Apple silicon · ${formatBytes(catalog.release.bytes)}`
    : 'Latest signed macOS release';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.wordmark} href="#top" aria-label="Minaco home">
          <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandImage} />
          <span>Minaco</span>
        </a>
        <nav className={styles.nav} aria-label="Main navigation">
          <a href="#agents">Agents</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/agent">Web Agent</Link>
        </nav>
        <div className={styles.accountActions}>
          <Link href="/sign-in">Log in</Link>
          <Link className={styles.headerAction} href="/sign-up">Create account</Link>
        </div>
      </header>

      <main id="top">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroMotif} aria-hidden="true">
            <MinacoBrandMark className={styles.heroMark} imageClassName={styles.heroMarkImage} variant="mark" />
          </div>
          <div className={styles.heroCopy}>
            <h1 id="hero-title">Your Agents.<br />One workspace.</h1>
            <p>Use supported native AI Agents and their ecosystems with one Minaco subscription. Switch specialists without restarting the work.</p>
            <div className={styles.heroActions}>
              <a className={styles.primaryAction} href={downloadUrl} data-analytics-cta="hero_download_macos">
                <Download aria-hidden="true" size={19} /> Download for macOS
              </a>
              <a className={styles.secondaryAction} href={productBrand.discordUrl} target="_blank" rel="noreferrer" data-analytics-cta="hero_join_discord">
                <DiscordLogo /> Join Discord
              </a>
            </div>
            <p className={styles.releaseLine}>{releaseText}. Download first; sign in when you open it.</p>
          </div>
          <div className={styles.folderStack} aria-label="One continuous Minaco workflow">
            <a className={`${styles.folder} ${styles.folderBack}`} href="#agents"><span>Native Agents</span></a>
            <a className={`${styles.folder} ${styles.folderMiddle}`} href="#how"><span>Continuous context</span></a>
            <a className={`${styles.folder} ${styles.folderNear}`} href="#pricing"><span>One account</span></a>
            <div className={`${styles.folder} ${styles.folderFront}`}>
              <strong>One Minaco conversation</strong>
              <p>Choose the best Agent for the next turn. Keep the project, files, visible context, and billing in one place.</p>
              <div className={styles.folderAgentLine}>
                {(agents.length ? agents.slice(0, 5) : [{ id: 'live', name: 'Live Agent catalog' } as PublicAgent]).map((agent) => <span key={agent.id}>{agent.name}</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.showcase} id="agents" aria-labelledby="agents-title">
          <div className={styles.agentIndex}>
            <h2 id="agents-title">The right Agent,<br />still your work.</h2>
            {agents.length ? (
              <div className={styles.agentNames}>
                {agents.map((agent) => (
                  <button key={agent.id} className={agent.id === activeAgent?.id ? styles.agentActive : ''} onMouseEnter={() => setAgentId(agent.id)} onFocus={() => setAgentId(agent.id)} onClick={() => setAgentId(agent.id)}>
                    <span>{agent.name}</span><small>{agent.vendor}</small>
                  </button>
                ))}
              </div>
            ) : <p className={styles.catalogUnavailable}>The live Agent catalog is temporarily unavailable. The download remains available from Desktop.</p>}
          </div>
          <div className={styles.showcaseDisc}>
            <AgentWorkspace agent={activeAgent} />
          </div>
          <p className={styles.agentFact}>{activeAgent ? `${activeAgent.name} remains ${activeAgent.vendor}'s Agent. Minaco manages the workspace around it.` : 'Agent availability comes from the live Desktop service, never a copied marketing list.'}</p>
        </section>

        <section className={styles.capabilities} aria-labelledby="capabilities-title">
          <div className={styles.sectionLead}>
            <h2 id="capabilities-title">Work,<br />finished.</h2>
            <p>Minaco adds continuity around native Agents without pretending they are the same product.</p>
          </div>
          <div className={styles.specimenGrid}>
            <article className={`${styles.specimen} ${styles.specimenWide}`}>
              <div className={styles.specimenStage} data-ui><HandoffFragment /></div>
              <h3>Cross-Agent handoff</h3><p>Visible context moves forward. Credentials do not.</p>
            </article>
            <article className={styles.specimen}>
              <div className={styles.specimenStage} data-ui><UsageFragment /></div>
              <h3>One Minaco balance</h3><p>Desktop and Web share the same account and credits.</p>
            </article>
            <article className={styles.specimen}>
              <div className={styles.specimenStage} data-ui><AccountFragment /></div>
              <h3>Native accounts</h3><p>Connect only the provider account you choose.</p>
            </article>
            <article className={styles.specimen}>
              <div className={styles.specimenStage} data-ui><ProjectFragment /></div>
              <h3>Local projects</h3><p>Files and native Agent state stay on your computer.</p>
            </article>
          </div>
        </section>

        <section className={styles.how} id="how" aria-labelledby="how-title">
          <div className={styles.howCopy}>
            <h2 id="how-title">{stages[stage].title}</h2>
            <p>{stages[stage].detail}</p>
          </div>
          <div className={styles.howPreview} data-ui>
            <StageFragment view={stages[stage].view} release={catalog.release?.version} agent={activeAgent?.name} />
          </div>
          <div className={styles.stageControl}>
            <input aria-label="Minaco setup stage" min="0" max="3" step="1" type="range" value={stage} onChange={(event) => setStage(Number(event.target.value))} />
            <div>{stages.map((item, index) => <button key={item.view} className={index === stage ? styles.stageActive : ''} onClick={() => setStage(index)}>{item.title.split(' ').slice(0, 2).join(' ')}</button>)}</div>
          </div>
        </section>

        <section className={styles.pricing} id="pricing" aria-labelledby="pricing-title">
          <div className={styles.pricingHeading}>
            <h2 id="pricing-title">One plan across<br />Desktop and Web.</h2>
            <p>The same Minaco account, subscription, and credit balance work in both products. Start free; upgrade when your workload grows.</p>
          </div>
          <div className={styles.freePlan}>Free includes the workspace, one concurrent task, and {catalog.plans.find((plan) => plan.key === 'FREE')?.modelTiers.join(' + ') || 'the entry model tier'}.</div>
          <div className={styles.planSteps}>
            {paidPlans.map((plan, index) => (
              <article key={plan.key} className={styles.plan} style={{ minHeight: `${390 + index * 86}px` }}>
                <h3>{plan.name}</h3>
                <strong>${plan.priceUsd}<small>/month</small></strong>
                <p>{plan.description}</p>
                <ul>
                  <li><span aria-hidden="true">•</span> {plan.monthlyCredits.toLocaleString('en-US')} credits each month</li>
                  <li><span aria-hidden="true">•</span> {plan.concurrentTasks} concurrent tasks</li>
                  <li><span aria-hidden="true">•</span> {plan.scheduledTasks} scheduled tasks</li>
                  <li><span aria-hidden="true">•</span> {plan.modelTiers.join(' + ')} models</li>
                </ul>
                <Link href="/pricing">Choose {plan.name}<span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.rates} aria-labelledby="rates-title">
          <div>
            <h2 id="rates-title">Know what<br />each turn costs.</h2>
            <p>Current Minaco-credit model rates come directly from the Desktop API. Figures are credits per one million tokens.</p>
          </div>
          {featuredModels.length ? <ModelRateTable models={featuredModels} /> : (
            <div className={styles.ratesUnavailable}>Live model rates are unavailable right now. Minaco will never substitute made-up prices.</div>
          )}
        </section>

        <section className={styles.webAgent} aria-labelledby="web-agent-title">
          <div>
            <h2 id="web-agent-title">Need web intelligence?</h2>
            <p>The original Minaco Agent remains available for competitor research, business data, and recurring intelligence work—with the same account and credits.</p>
          </div>
          <Link href="/agent">Open Minaco Web Agent<ArrowRight size={18} /></Link>
        </section>

        <section className={styles.faq} aria-labelledby="faq-title">
          <h2 id="faq-title">Questions,<br />filed clearly.</h2>
          <div className={styles.faqStack}>
            {faqs.map(([topic, question, answer], index) => (
              <article key={topic} className={index === faq ? styles.faqOpen : ''}>
                <button onClick={() => setFaq(index)} aria-expanded={index === faq}>
                  <span>{topic}</span><strong>{question}</strong>
                </button>
                {index === faq && <p>{answer}</p>}
              </article>
            ))}
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="cta-title">
          <div>
            <h2 id="cta-title">Start with<br />the work.</h2>
            <p>Download first. Your Minaco account connects when the app opens.</p>
          </div>
          <div className={styles.createDialog} data-ui>
            <h3>Name your first workspace</h3>
            <label htmlFor="workspace-name">Workspace name</label>
            <input id="workspace-name" value={workspace} onChange={(event) => setWorkspace(event.target.value)} />
            <div className={styles.modeChoice}><button className={styles.modeSelected}>Work</button><button>Code</button></div>
            <a href={downloadUrl}><Download size={18} /> Download and create “{workspace || 'New workspace'}”</a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerMark}><MinacoBrandMark imageClassName={styles.footerMarkImage} variant="mark" /></div>
        <div className={styles.footerLinks}>
          <div><strong>Product</strong><a href="#agents">Agents</a><a href="#pricing">Pricing</a><Link href="/agent">Web Agent</Link></div>
          <div><strong>Account</strong><Link href="/sign-up">Create account</Link><Link href="/sign-in">Log in</Link><Link href="/pricing">Manage plan</Link></div>
          <div><strong>Company</strong><Link href="/blog">Blog</Link><Link href="/contact">Contact</Link><a href={productBrand.discordUrl}>Discord</a></div>
          <div><strong>Legal</strong><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
          <p>{productBrand.supportEmail}<br />{releaseText}</p>
        </div>
        <div className={styles.footerBottom}><span>© {new Date().getFullYear()} Minaco</span><a href={downloadUrl}>Download macOS<ExternalLink size={14} /></a></div>
      </footer>
    </div>
  );
}

function AgentWorkspace({ agent }: { agent?: PublicAgent }) {
  return <div className={styles.agentWindow} data-ui>
    <aside><MinacoBrandMark imageClassName={styles.miniMark} /><strong>Minaco</strong><button>New workspace</button><small>Workspaces</small><span className={styles.selectedWorkspace}>Launch plan</span><span>Product research</span></aside>
    <div className={styles.agentChat}><header><strong>Launch plan</strong><span>{agent?.name || 'Live catalog'}</span></header><div className={styles.userMessage}>Take this research and turn it into an implementation plan.</div><div className={styles.agentMessage}><strong>{agent?.name || 'Agent'}</strong><p>I have the visible context, files, and prior tool activity. I’ll continue from the decision that matters next.</p><ul><li>Confirm the release target</li><li>Map the smallest safe change</li><li>Run the acceptance checks</li></ul></div><div className={styles.composer}>Message {agent?.name || 'the Agent'}<span>Send</span></div></div>
  </div>;
}

function HandoffFragment() { return <div className={styles.handoffFragment}><span>Codex · Minaco</span><ArrowRight size={18} /><span>Claude Code · Minaco</span><p>Visible messages + tool activity</p><small>Credentials never transferred</small></div>; }
function UsageFragment() { return <div className={styles.usageFragment}><span>This turn</span><strong>9 credits</strong><dl><div><dt>Input</dt><dd>66,383</dd></div><div><dt>Cached</dt><dd>41,920</dd></div><div><dt>Output</dt><dd>128</dd></div></dl></div>; }
function AccountFragment() { return <div className={styles.accountFragment}><strong>Personal accounts</strong><p>Codex <span>Connected</span></p><p>Claude Code <button>Connect</button></p><small>Managed in Minaco · isolated by Agent</small></div>; }
function ProjectFragment() { return <div className={styles.projectFragment}><strong>minaco-launch</strong><p>README.md <span>18 KB</span></p><p>research/ <span>12 files</span></p><p>app/ <span>Local</span></p><small>~/Projects/minaco-launch</small></div>; }

function StageFragment({ view, release, agent }: { view: string; release?: string; agent?: string }) {
  if (view === 'download') return <div className={styles.stageDownload}><MinacoBrandMark imageClassName={styles.stageLogo} variant="appIcon" /><strong>Minaco {release || 'for macOS'}</strong><span>Ready to open</span><button>Open Minaco</button></div>;
  if (view === 'agents') return <div className={styles.stageAgents}><strong>Choose an Agent</strong>{[agent || 'Current Agent', 'Another installed Agent', 'Install when needed'].map((name, index) => <p key={name} className={index === 0 ? styles.stageRowSelected : ''}><span>{name}</span><small>{index === 2 ? 'Install' : 'Ready'}</small></p>)}</div>;
  if (view === 'handoff') return <HandoffFragment />;
  return <UsageFragment />;
}

function ModelRateTable({ models }: { models: PublicModelRate[] }) {
  return <div className={styles.rateTable} role="table" aria-label="Minaco model credit rates">
    <div className={styles.rateHeader} role="row"><span>Model</span><span>Input</span><span>Cached</span><span>Output</span></div>
    {models.map((model) => <div key={`${model.provider}:${model.model}`} className={styles.rateRow} role="row"><span><strong>{model.label}</strong><small>{model.engines.join(', ') || model.provider}</small></span><span>{formatRate(model.input)}</span><span>{formatRate(model.cachedInput)}</span><span>{formatRate(model.output)}</span></div>)}
  </div>;
}

function distinctModels(models: PublicModelRate[]) {
  const seen = new Set<string>();
  return models.filter((model) => !seen.has(model.model) && !!seen.add(model.model));
}
function formatRate(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value); }
function formatBytes(value: number) { return `${Math.round(value / 1024 / 1024)} MB`; }

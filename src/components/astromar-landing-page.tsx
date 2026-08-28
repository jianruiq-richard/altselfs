"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MinacoBrandMark } from "@/components/minaco-brand-mark";
import { productBrand } from "@/lib/brand";
import styles from "./astromar-landing-page.module.css";

const scenarios = [
  {
    lead: `${productBrand.name} sizes up your competitor.`,
    decision: "Decide your strategy.",
    detail: "Users, revenue, growth trajectory - the numbers on any competitor, pulled in seconds.",
  },
  {
    lead: `${productBrand.name} tracks competitor moves.`,
    decision: "Decide your action.",
    detail: "KOC drops, paid campaigns, channel shifts - what they did yesterday and what it means for today.",
  },
  {
    lead: `${productBrand.name} finds who needs your product.`,
    decision: "Decide your outreach.",
    detail:
      `Your first 100 users are already out there. ${productBrand.name} finds where they gather, what they care about, and how to reach them before anyone else does.`,
  },
] as const;

const contextSources = ["Google Workspace", "Gmail", "Slack", "Notion", "YouTube", "TikTok", "X", "Search"];

const cofounderProofs = [
  "65% of high-potential startups fail because of cofounder conflict.",
  "Most cofounders rush their equity split in under a day - before roles or trust are established.",
  "Every human cofounder has a life, a limit, and an agenda that isn't yours.",
] as const;

const marketTools = [
  {
    name: "Similarweb",
    src: "/connector-logos/similarweb.svg",
    width: 1609,
    height: 1513,
  },
  {
    name: "Semrush",
    src: "/connector-logos/semrush.svg",
    width: 37,
    height: 23,
  },
  {
    name: "Ahrefs",
    src: "/connector-logos/ahrefs.png",
    width: 1020,
    height: 640,
    wide: true,
  },
  {
    name: "Appark",
    src: "/connector-logos/appark-icon.png",
    width: 48,
    height: 48,
  },
  {
    name: "Sensor Tower",
    src: "/connector-logos/sensor-tower-icon.png",
    width: 48,
    height: 48,
  },
] as const;

const agentBrainPoints = [
  "Most AI tools wait to be told what to do. Minaco decides what needs doing \u2014 then tells them.",
  "It orchestrates research, coding, outreach, and growth agents \u2014 calling the right specialist at the right moment, through one conversation.",
  "The more decisions you make together, the more Minaco thinks like you. Your judgment compounds over time.",
] as const;

const demoScenarios = [
  {
    tab: "01 Competitor Intelligence",
    tabTitle: "Market intelligence on Lovable's last six months.",
    sidebarTitle: "Lovable market intelligence",
    workspaceTitle: "Lovable six-month market model",
    prompt:
      "Analyze Lovable's last six months. Use traffic tools, search data, and comparable startup cases. I need user growth, revenue, cost, and the next question I should ask.",
    intro:
      "I pulled monthly traffic from Similarweb, checked Semrush search and paid signals, then matched Lovable against Minaco's commercial database of AI devtool companies with similar traffic-to-revenue curves. Public anchors: Lovable crossed $400M ARR in Feb 2026 and $500M annualized revenue in Jun 2026.",
    activeTitle: "Lovable operating model",
    activeCopy: "Traffic, search, revenue, cost, and comparable-case signals consolidated into one market read.",
    connectors: ["Similarweb", "Semrush", "Commercial database", "Web research"],
    tableTitle: "Six-month operating model",
    tableHeaders: ["Month", "Visits", "New Users", "Total Users", "MRR", "Full Cost"],
    tableRows: [
      ["Jan", "31.8M", "620K", "4.8M", "$25.0M", "$12.4M"],
      ["Feb", "37.4M +17.6%", "740K +19.4%", "5.54M +15.4%", "$33.3M +33.2%", "$15.8M"],
      ["Mar", "43.2M +15.5%", "860K +16.2%", "6.40M +15.5%", "$35.4M +6.3%", "$16.4M"],
      ["Apr", "46.28M +7.1%", "940K +9.3%", "7.34M +14.7%", "$37.5M +5.9%", "$17.2M"],
      ["May", "50.6M +9.3%", "1.02M +8.5%", "8.36M +13.9%", "$39.6M +5.6%", "$18.1M"],
      ["Jun", "50.01M -1.2%", "1.00M -2.0%", "9.36M +12.0%", "$41.7M +5.3%", "$19.2M"],
    ],
    sections: [
      {
        title: "June cost stack",
        body:
          "Model inference $7.2M, cloud/storage $1.6M, payroll $3.4M, KOC/creator seeding $0.9M, paid acquisition $2.0M, PR/events $0.6M, B2B partnerships $1.5M, support/ops $1.2M, payment/legal/admin $0.8M.",
      },
      {
        title: "Signal",
        body:
          "The useful signal is not just growth. Traffic flattened in June, but revenue still grew 5.3%. That usually means one of three things: better paid conversion, stronger enterprise mix, or pricing/credit expansion.",
      },
    ],
    followUps: ["Compare Lovable vs Bolt", "Find under-monetized competitors", "Model CAC by channel"],
    railMetrics: [
      ["Jun visits", "50.01M"],
      ["Jun MRR", "$41.7M"],
      ["Full cost", "$19.2M"],
    ],
    sourceNote: "Public signals + Minaco commercial model",
  },
  {
    tab: "02 Weekly Competitor Movement",
    tabTitle: "Weekly competitor movement on OpusClip.",
    sidebarTitle: "OpusClip growth moves",
    workspaceTitle: "What changed at OpusClip?",
    prompt:
      "What did OpusClip change this week? What did they ship, how did they promote it, and what should we expect in revenue?",
    intro:
      "The visible release window is Jul 22-27. OpusClip shipped three conversion-oriented features in six days: Auto Headline inside Brand Template, Viral Fine-Cut Presets, and Bad Takes Removal. This is not a feature dump. They are moving from \"make clips\" to \"make publish-ready assets with less editing judgment from the user.\"",
    activeTitle: "OpusClip movement read",
    activeCopy: "Product releases, launch surface, creator seeding, paid model, and revenue impact summarized.",
    connectors: ["Semrush", "Web research", "YouTube", "TikTok"],
    tableTitle: "Movement model",
    tableHeaders: ["Signal", "What changed", "Minaco read"],
    tableRows: [
      ["Product", "3 releases in 6 days", "Faster activation for non-editors"],
      ["Owned launch", "Changelog + in-product entry points", "Low-cost conversion push"],
      ["PR", "No broad earned-media spike detected", "Not a press-led launch"],
      ["KOC model", "18 micro-creators x $350", "$6.3K test spend"],
      ["Paid model", "$2K/day x 10 days", "$20K creative/retargeting test"],
      ["Revenue model", "3,600 trials x 8.5% paid conversion x $29/mo", "+306 paid users, +$8.9K MRR"],
    ],
    sections: [
      {
        title: "Expected impact",
        body:
          "This campaign does not justify broad paid scaling yet. At $26.3K estimated acquisition spend and $8.9K new MRR, payback is roughly 3.7 months before churn. Good enough to continue testing, not good enough to flood the channel.",
      },
    ],
    followUps: ["Build a $20K test plan", "Find the creator list", "Model payback by channel"],
    railMetrics: [
      ["Spend model", "$26.3K"],
      ["New MRR", "$8.9K"],
      ["Payback", "3.7 months"],
    ],
    sourceNote: "Release notes + channel model",
  },
  {
    tab: "03 Find Seed Users",
    tabTitle: "Find 100 seed users for AI long story video.",
    sidebarTitle: "Reddit seed user plan",
    workspaceTitle: "Find 100 AI story video users",
    prompt:
      "Find 100 seed users for my AI long story video product. Use Reddit only. Be specific.",
    intro:
      "Go to Reddit, not ads. Your first 100 users are not \"AI tool users.\" They are faceless YouTube creators, AI video makers, and story-channel operators who already need longer narrative videos. Primary subreddit: r/aivideo. It is the cleanest fit: AI-generated video creators, tool experiments, Runway / LTX / Seedance-style posts, tutorials, and showcase threads. Start there with a founder AMA.",
    activeTitle: "Reddit seed sprint",
    activeCopy: "Subreddits, founder posts, AMA body, activation definition, cost, and 14-day targets set.",
    connectors: ["Reddit posting tool", "Web research", "Community monitor"],
    tableTitle: "Action plan",
    tableHeaders: ["Subreddit", "What to Post", "Goal"],
    tableRows: [
      [
        "r/aivideo",
        "I'm building an AI long-story video maker for faceless creators. I'll turn 10 story ideas into pilot videos for free. AMA.",
        "35 activated users",
      ],
      [
        "r/NewTubers",
        "I tested a 12-minute AI story video workflow. Here are the actual costs, render time, and failure points.",
        "25 activated users",
      ],
      [
        "r/YouTubeAutomation",
        "For faceless story channels: would a long-form AI story video tool save time or increase channel risk?",
        "25 activated users",
      ],
      [
        "r/VideoEditing",
        "Post inside weekly / workflow threads: Where does AI story video still need human editing?",
        "10 activated users",
      ],
      [
        "r/aiagents",
        "I built a workflow that turns a story into a narrated long video. What should the agent control vs leave to the creator?",
        "5 activated users",
      ],
    ],
    sections: [
      {
        title: "Execution",
        body:
          "Use Minaco's Reddit posting tool to publish from the founder account, monitor every comment, draft fast replies, collect interested users, and turn real questions into follow-up posts. Do not send people a generic signup link. Ask them to submit one story idea. Activation means they generate one 8-12 minute pilot video or three usable scenes.",
      },
      {
        title: "AMA body",
        body:
          "I'm building an AI long-story video tool for faceless creators. The goal is not Shorts slop. The goal is 8-30 minute story videos with stable characters, voice, pacing, captions, and lower editing time. Drop a story idea, Reddit post, script, or channel format. I'll reply with the production plan, estimated cost, and where the current AI workflow will probably break. I'll also make 10 free pilot clips for people whose use case is real.",
      },
      {
        title: "Cost / timeline",
        body:
          "14 days. $0 ad spend. $800-$1,200 in generation credits. 2 founder hours/day. Target: 150 interested comments/DMs, 60 submitted story ideas, 100 activated users, 15-25 users willing to pay for the next video.",
      },
    ],
    followUps: ["Draft the AMA post", "Start monitoring r/aivideo", "Collect story submissions"],
    railMetrics: [
      ["Timeline", "14 days"],
      ["Ad spend", "$0"],
      ["Activated", "100 users"],
    ],
    sourceNote: "Reddit communities + founder account workflow",
  },
] as const;

const footerSections = [
  {
    title: "Product",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Blog", href: "/blog" },
      { label: "Use cases", href: "#demo" },
      { label: "How it thinks", href: "#demo" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/sign-in?method=email" },
      { label: "Get started", href: "/sign-up?method=email" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Contact", href: "/contact" },
    ],
  },
] as const;

function classes(...names: Array<string | false>) {
  return names.map((name) => (name ? styles[name] : "")).filter(Boolean).join(" ");
}

export function AstromarLandingPage() {
  const [currentScenario, setCurrentScenario] = useState(0);
  const demo = demoScenarios[currentScenario];

  return (
    <main className={styles.landing}>
      <nav className={styles.nav}>
        <div className={classes("container", "navInner")}>
          <Link className={styles.brand} href="/" aria-label={`${productBrand.name} home`}>
            <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandMarkImage} />
            <span className={styles.brandName}>{productBrand.name}</span>
            <span className={styles.brandTagline}>{productBrand.tagline}</span>
          </Link>

          <div className={styles.navLinks} aria-label="Primary navigation">
            <Link href="/pricing">Pricing</Link>
            <a href="#demo">Use cases</a>
            <Link href="/blog">Blog</Link>
          </div>

          <div className={styles.authActions} aria-label="Account actions">
            <Link
              className={styles.button}
              href="/sign-in?method=email"
              data-analytics-cta="nav_sign_in"
              data-analytics-location="landing_nav"
            >
              Sign in
            </Link>
            <Link
              className={classes("button", "buttonPrimary")}
              href="/sign-in?method=email&redirect_url=/investor/chat/100"
              data-analytics-cta="nav_get_started"
              data-analytics-location="landing_nav"
            >
              Try for free
            </Link>
          </div>
        </div>
      </nav>

      <section className={classes("container", "hero")}>
        <p className={styles.heroPositioning}>
          {productBrand.name} is your AI cofounder, built to think with you, not just work for you.
        </p>

        <div className={styles.heroCarousel} aria-label="Founder decision scenarios">
          <div className={styles.scenarioTrack}>
            {scenarios.map((scenario, index) => (
              <div className={styles.scenario} key={scenario.lead}>
                <h1 className={styles.headline}>
                  <span>
                    {scenario.lead === `${productBrand.name} sizes up your competitor.` ? (
                      <>
                        {productBrand.name} sizes up <br className={styles.mobileOnly} />your competitor.
                      </>
                    ) : (
                      scenario.lead
                    )}
                  </span>
                  <br />
                  {index === 0 ? (
                    <>
                      Decide your <br className={styles.mobileOnly} />strategy.
                    </>
                  ) : (
                    scenario.decision
                  )}
                </h1>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.copyCarousel} aria-label="Scenario details">
          <div className={styles.copyTrack}>
            {scenarios.map((scenario) => (
              <p className={styles.heroCopy} key={scenario.detail}>
                {scenario.detail}
              </p>
            ))}
          </div>
        </div>

        <div className={styles.heroActions}>
          <Link
            className={classes("button", "buttonPrimary", "buttonLarge")}
            href="/sign-up?method=email"
            data-analytics-cta="hero_talk_to_cofounder"
            data-analytics-location="landing_hero"
          >
            Try for free
            <ArrowRight aria-hidden="true" size={18} strokeWidth={2} />
          </Link>
          <a
            className={classes("button", "buttonLarge")}
            href="#demo"
            data-analytics-cta="hero_view_demo"
            data-analytics-location="landing_hero"
          >
            See how it thinks
          </a>
        </div>

        <div className={styles.contextRow} aria-label="Example connected context sources">
          {contextSources.map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
      </section>

      <section className={classes("container", "section", "founderReasons")} id="why">
        <div className={styles.reasonStack}>
          <article className={classes("reasonBlock", "reasonBlockLead")}>
            <div className={styles.reasonText}>
              <p className={styles.eyebrow}>Why you need an AI cofounder</p>
              <h2>
                No ego. <br className={styles.mobileOnly} />No hidden agenda. <br className={styles.mobileOnly} />No politics.
              </h2>
              <p>
                Every human cofounder brings interests that don&apos;t fully align with yours. {productBrand.name}{" "}doesn&apos;t.
                It has no equity to protect, no reputation to manage, no side to take. Just your outcome.
              </p>
            </div>
            <div className={styles.reasonSupport}>
              <div className={styles.principleList} aria-label="AI cofounder alignment principles">
                {cofounderProofs.map((proof) => (
                  <span key={proof}>
                    <i aria-hidden="true" />
                    <strong className={styles.principleCopy}>{proof}</strong>
                  </span>
                ))}
              </div>
            </div>
          </article>

          <article className={classes("reasonBlock", "reasonBlockMarket")}>
            <div className={styles.reasonText}>
              <p className={styles.eyebrow}>Market intelligence</p>
              <h2>
                Enterprise market <br className={styles.mobileOnly} />intelligence. <br className={styles.mobileOnly} />Founder pricing.
              </h2>
              <p>
                The market intelligence stack used to mean five separate subscriptions, thousands a month, and someone
                full-time to make sense of it. {productBrand.name} integrates them all {"\u2014"} a fraction of the cost,
                none of the overhead. {productBrand.name}&apos;s commercial database covers thousands of real startup cases{" "}
                {"\u2014"} with actual revenue figures and growth trajectories that never surface in a dashboard. You
                don&apos;t just see their traffic. You see their revenue.
              </p>
            </div>
            <div className={styles.reasonSupport}>
              <div className={styles.marketNote}>42% of products that could have won, died on the growth side.</div>
              <div className={styles.marketTools} aria-label="Integrated market intelligence tools">
                {marketTools.map((tool) => (
                  <div className={styles.toolLogo} key={tool.name}>
                    <span className={classes("toolLogoIcon", "wide" in tool && tool.wide && "toolLogoIconWide")}>
                      <Image src={tool.src} alt="" width={tool.width} height={tool.height} />
                    </span>
                    <span>{tool.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className={classes("reasonBlock", "reasonBlockSolo")}>
            <div className={styles.reasonText}>
              <p className={styles.eyebrow}>Solo founder leverage</p>
              <h2>
                Other AI agents are hands. <br className={styles.mobileOnly} />{productBrand.name} is the brain.
              </h2>
              <p>
                {productBrand.name} sits above the stack. It reads your full context {"\u2014"} email, docs, meetings,
                platforms {"\u2014"} then decides which agents to call, what to ask them, and what to do with what they
                return. You make decisions with {productBrand.name}.{" "}
                <strong>{productBrand.name} is built to think with you, not just work for you.</strong>
              </p>
            </div>
            <div className={styles.reasonSupport}>
              <div className={styles.agentBrainList} aria-label={`${productBrand.name} agent orchestration`}>
                {agentBrainPoints.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className={classes("container", "section")} id="demo">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>AI cofounder in the decision room</p>
            <h2>Ask once. Watch the work. Decide with evidence.</h2>
          </div>
          <p className={styles.sectionCopy}>
            {productBrand.name} behaves like a founder partner inside the product: it reads the selected context,
            connects the right sources, and returns a completed answer with the data, model, and next questions already
            assembled.
          </p>
        </div>

        <div className={styles.scenarioTabs} role="tablist" aria-label="Decision preview scenarios">
          {demoScenarios.map((item, index) => (
            <button
              className={classes("scenarioTab", index === currentScenario && "isActive")}
              type="button"
              role="tab"
              aria-selected={index === currentScenario}
              key={item.tab}
              onClick={() => setCurrentScenario(index)}
            >
              <span>{item.tab}</span>
              <strong>{item.tabTitle}</strong>
            </button>
          ))}
        </div>

        <div className={styles.demoFrame} aria-label={`${productBrand.name} discussion workspace preview`}>
          <div className={styles.windowBar}>
            <div className={styles.windowDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={styles.windowTitle}>{productBrand.protocolScheme}://discussion</div>
            <div className={styles.secureContext}>Secure context</div>
          </div>

          <div className={styles.workspacePreview}>
            <aside className={styles.workspaceSidebar} aria-label="Workspace navigation">
              <div className={styles.workspaceBrand}>
                <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandMarkImage} />
                <span>{productBrand.name}</span>
              </div>
              <button className={styles.newDiscussion} type="button">+ New discussion</button>
              <nav className={styles.workspaceNav} aria-label="Workspace">
                {["Discussion", "Home", "Connectors", "Settings"].map((item, index) => (
                  <span className={index === 0 ? styles.isActive : undefined} key={item}>
                    <i className={styles.navIcon} aria-hidden="true" />
                    {item}
                  </span>
                ))}
              </nav>
              <div className={styles.discussionList}>
                <div className={styles.discussionHeading}><span>Discussions</span><span>3</span></div>
                <div className={classes("discussionRow", "isActive")}>
                  <div>
                    <strong>{demo.sidebarTitle}</strong>
                    <small>Completed - 3 messages</small>
                  </div>
                  <span aria-hidden="true">...</span>
                </div>
                <div className={styles.discussionRow}>
                  <div>
                    <strong>First 100 design partners</strong>
                    <small>08/06 - 7 messages</small>
                  </div>
                </div>
                <div className={styles.discussionRow}>
                  <div>
                    <strong>Q3 activation decision</strong>
                    <small>08/03 - 11 messages</small>
                  </div>
                </div>
              </div>
              <div className={styles.workspaceUser}>
                <span className={styles.avatar}>RJ</span>
                <div>
                  <strong>Founder</strong>
                  <span>founder@company.ai</span>
                </div>
              </div>
            </aside>

            <section className={styles.workspaceMain}>
              <header className={styles.workspaceHeader}>
                <div>
                  <strong>{demo.workspaceTitle}</strong>
                  <span>{productBrand.tagline}</span>
                </div>
                <div className={styles.modelSelect}>{productBrand.name} Pro v</div>
              </header>

              <div className={styles.thread}>
                <div className={styles.threadDay}>Today</div>
                <div className={classes("message", "messageUser")}>
                  <div>{demo.prompt}</div>
                  <div className={styles.submissionState}>
                    <i className={styles.completionDot} aria-hidden="true" />
                    <span>Completed</span>
                  </div>
                </div>
                <div className={styles.assistantBlock}>
                  <span className={styles.assistantMark} aria-hidden="true"><i /></span>
                  <div>
                    <div className={styles.assistantLabel}>{productBrand.name}</div>
                    <p className={styles.assistantIntro}>{demo.intro}</p>
                    <article className={styles.resultPanel}>
                      <div className={styles.resultHeader}>
                        <small>Completed result</small>
                        <span>{demo.sourceNote}</span>
                      </div>
                      <section className={styles.resultSection}>
                        <h3>{demo.tableTitle}</h3>
                        <div className={styles.resultTableWrap}>
                          <table className={styles.resultTable}>
                            <thead>
                              <tr>
                                {demo.tableHeaders.map((header) => (
                                  <th key={header}>{header}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {demo.tableRows.map((row) => (
                                <tr key={row.join("-")}>
                                  {row.map((cell) => (
                                    <td key={cell}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                      {demo.sections.map((section) => (
                        <section className={styles.resultSection} key={section.title}>
                          <h3>{section.title}</h3>
                          <p>{section.body}</p>
                        </section>
                      ))}
                      <div className={styles.followUpRow} aria-label="Suggested follow-up questions">
                        {demo.followUps.map((item) => (
                          <button className={styles.followUpChip} type="button" key={item}>
                            {item}
                          </button>
                        ))}
                      </div>
                    </article>
                  </div>
                </div>
              </div>

              <div className={styles.composer}>
                <div className={styles.composerConnectors}>
                  {demo.connectors.map((item) => (
                    <span className={styles.composerChip} key={item}>
                      <i aria-hidden="true" />
                      {item}
                    </span>
                  ))}
                </div>
                <div className={styles.composerText}>Ask {productBrand.name} to research, decide, or build a plan...</div>
                <div className={styles.composerActions}>
                  <div>
                    <button className={styles.miniButton} type="button">Attach</button>
                    <button className={styles.miniButton} type="button">Think</button>
                  </div>
                  <button className={styles.sendButton} type="button" aria-label="Send message">^</button>
                </div>
              </div>
            </section>

            <aside className={styles.workspaceRail} aria-label="Discussion context">
              <div className={styles.capacityStrip}>
                <div>
                  <strong>8,460</strong>
                  <span>credits available</span>
                </div>
                <div>
                  <strong>1 / 10</strong>
                  <span>tasks active</span>
                </div>
              </div>
              <div className={styles.railBody}>
                <section className={styles.railSection}>
                  <div className={styles.railHeader}>
                    <h3>Active work</h3>
                    <span>Done</span>
                  </div>
                  <div className={styles.activeWorkCard}>
                    <div className={styles.activeWorkTop}>
                      <strong>{demo.activeTitle}</strong>
                      <span className={styles.statusPill}>
                        <i aria-hidden="true" />
                        Done
                      </span>
                    </div>
                    <p>{demo.activeCopy}</p>
                    <div className={styles.workTimer}>Static completed preview</div>
                  </div>
                </section>

                <section className={styles.railSection}>
                  <div className={styles.railHeader}>
                    <h3>Key outputs</h3>
                    <span>{demo.railMetrics.length}</span>
                  </div>
                  <div className={styles.railMetricList}>
                    {demo.railMetrics.map(([label, value]) => (
                      <div className={styles.railMetricRow} key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={styles.railSection}>
                  <div className={styles.railHeader}>
                    <h3>Connector context</h3>
                    <span>{demo.connectors.length}/4 enabled</span>
                  </div>
                  <div className={styles.connectorList}>
                    {demo.connectors.map((item) => (
                      <div className={styles.connectorRow} key={item}>
                        <span className={styles.connectorIcon} aria-hidden="true" />
                        <span>
                          <strong>{item}</strong>
                          <span>Enabled for this discussion</span>
                        </span>
                        <span className={styles.toggle} aria-hidden="true" />
                      </div>
                    ))}
                  </div>
                </section>

                <div className={styles.railFootnote}>
                  <span aria-hidden="true">i</span>
                  <span>Enabled sources are available to this discussion. Workspace memory keeps the thread across decisions.</span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={classes("container", "footerInner")}>
          <div className={styles.footerBrand}>
            <Link className={styles.brand} href="/" aria-label={`${productBrand.name} home`}>
              <MinacoBrandMark className={styles.brandMark} imageClassName={styles.brandMarkImage} />
              <span className={styles.brandName}>{productBrand.name}</span>
            </Link>
            <p>Your AI cofounder workspace for startup context, connected work data, and founder decisions.</p>
          </div>

          <div className={styles.footerGrid}>
            {footerSections.map((section) => (
              <div className={styles.footerColumn} key={section.title}>
                <h3>{section.title}</h3>
                {section.links.map((link) => (
                  <Link href={link.href} key={`${section.title}-${link.label}`}>
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className={classes("container", "footerBottom")}>
          <span>{productBrand.tagline}</span>
          <span>&copy; 2026 {productBrand.name}</span>
        </div>
      </footer>
    </main>
  );
}

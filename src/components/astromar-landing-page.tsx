import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BillingPlanGrid } from "@/components/billing-plan-grid";
import { productBrand } from "@/lib/brand";
import styles from "./astromar-landing-page.module.css";

const scenarios = [
  {
    lead: "Know competitor moves.",
    decision: "Decide your action.",
    detail:
      `Track competitor activity across all channels. ${productBrand.name} shows you their playbook and suggests your counter-strategy.`,
  },
  {
    lead: "Find who needs your product.",
    decision: "Decide your outreach.",
    detail:
      `Your first 100 users are already out there. ${productBrand.name} finds where they gather, what they care about, and how to reach them before anyone else does.`,
  },
  {
    lead: "From idea to live.",
    decision: "Decide what ships first.",
    detail:
      `Not a prototype. Not a demo. ${productBrand.name} helps you break down any idea into a shippable first version — then tells you exactly what to build on day one.`,
  },
] as const;

const contextSources = ["Gmail", "Slack", "Notion", "YouTube", "TikTok", "X", "Search"];

const activity = [
  {
    text: (
      <>
        <b>38 YouTube KOC videos</b> detected around creator workflow tutorials.
      </>
    ),
    value: "1.4M reach",
  },
  {
    text: (
      <>
        <b>112 TikTok posts</b> reused the same hook: turn long videos into 10 clips.
      </>
    ),
    value: "2.1M views",
  },
  {
    text: (
      <>
        <b>Paid search expanded</b> on AI video clipping and podcast shorts generator.
      </>
    ),
    value: "$8.6K spend",
  },
  {
    text: (
      <>
        <b>Estimated new users</b> from yesterday&apos;s blended channels.
      </>
    ),
    value: "9.2K-13.5K",
  },
] as const;

const useCases = [
  {
    index: "01",
    title: "Know competitor moves. Decide your action.",
    copy:
      `Track competitor activity across all channels. ${productBrand.name} shows you their playbook and suggests your counter-strategy.`,
  },
  {
    index: "02",
    title: "Find who needs your product. Decide your outreach.",
    copy:
      `Your first 100 users are already out there. ${productBrand.name} finds where they gather, what they care about, and how to reach them before anyone else does.`,
  },
  {
    index: "03",
    title: "From idea to live. Decide what ships first.",
    copy:
      `Not a prototype. Not a demo. ${productBrand.name} helps you break down any idea into a shippable first version — then tells you exactly what to build on day one.`,
  },
] as const;

function classes(...names: string[]) {
  return names.map((name) => styles[name]).filter(Boolean).join(" ");
}

export function AstromarLandingPage() {
  return (
    <main className={styles.landing}>
      <nav className={styles.nav}>
        <div className={classes("container", "navInner")}>
          <Link className={styles.brand} href="/" aria-label={`${productBrand.name} home`}>
            <span className={styles.brandMark} aria-hidden="true" />
            <span className={styles.brandName}>{productBrand.name}</span>
            <span className={styles.brandTagline}>{productBrand.tagline}</span>
          </Link>

          <div className={styles.navLinks} aria-label="Primary navigation">
            <Link href="/pricing">Pricing</Link>
            <a href="#cases">Use cases</a>
            <a href="#conversation">How it thinks</a>
          </div>

          <div className={styles.authActions} aria-label="Account actions">
            <Link className={styles.button} href="/sign-in?method=email">
              Sign in
            </Link>
            <Link className={classes("button", "buttonPrimary")} href="/sign-in?method=email&redirect_url=/investor/chat/100">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <section className={classes("container", "hero")}>
        <p className={styles.heroPositioning}>
          Your AI cofounder, built to think with you, not just work for you.
        </p>

        <div className={styles.heroCarousel} aria-label="Founder decision scenarios">
          <div className={styles.scenarioTrack}>
            {scenarios.map((scenario) => (
              <div className={styles.scenario} key={scenario.lead}>
                <h1 className={styles.headline}>
                  <span>{scenario.lead}</span>
                  <br />
                  {scenario.decision}
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
          <Link className={classes("button", "buttonPrimary", "buttonLarge")} href="/sign-up?method=email">
            Talk to your AI cofounder
            <ArrowRight aria-hidden="true" size={18} strokeWidth={2} />
          </Link>
          <a className={classes("button", "buttonLarge")} href="#conversation">
            See how it thinks
          </a>
        </div>

        <div className={styles.contextRow} aria-label="Example connected context sources">
          {contextSources.map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
      </section>

      <section className={classes("container", "section")} id="demo">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Competitive intelligence as the first move</p>
            <h2>One command. A full competitor brief. Then a decision.</h2>
          </div>
          <p className={styles.sectionCopy}>
            The first use case is concrete enough to be useful on day one, but the product behavior is broader:
            {productBrand.name} turns any signal into a decision conversation.
          </p>
        </div>

        <div className={styles.demoFrame} aria-label={`${productBrand.name} decision room preview`}>
          <div className={styles.windowBar}>
            <div className={styles.windowDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={styles.windowTitle}>{productBrand.protocolScheme}://decision-room</div>
            <div className={styles.secureContext}>Secure context</div>
          </div>

          <div className={styles.demoBody}>
            <div className={styles.chatPane}>
              <div className={classes("message", "messageUser")}>
                <strong>You</strong>
                What did Opus Clip do yesterday, and should we respond?
              </div>
              <div className={classes("message", "messageAgent")}>
                <strong>{productBrand.name}</strong>
                Running cross-channel intelligence across traffic, search, social, and creator activity. I will
                prioritize deltas that change your growth plan today.
              </div>
              <div className={classes("message", "messageAgent")}>
                <strong>{productBrand.name}</strong>
                The real decision is not whether they posted. It is whether you compete on the same creator channel
                or attack the use case they are ignoring.
              </div>
              <div className={styles.sourceStrip} aria-label="Connected data sources">
                {["Similarweb", "Semrush", "TikTok", "YouTube", "Instagram", "X"].map((source) => (
                  <span className={styles.sourceChip} key={source}>
                    {source}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.intelPane}>
              <div className={styles.intelHeader}>
                <div>
                  <h3>Opus Clip decision brief</h3>
                  <p>
                    Signal confidence: high. Estimates are modeled from public traffic, creator reach, paid activity,
                    and landing-page changes.
                  </p>
                </div>
                <span className={styles.liveBadge}>
                  <span aria-hidden="true" /> Live brief
                </span>
              </div>

              <div className={styles.metricGrid}>
                <div className={styles.metric}>
                  <span>Live since</span>
                  <strong>2022</strong>
                </div>
                <div className={styles.metric}>
                  <span>User scale</span>
                  <strong>5M+</strong>
                </div>
                <div className={styles.metric}>
                  <span>Revenue est.</span>
                  <strong>$18-28M ARR</strong>
                </div>
              </div>

              <div className={styles.activityCard}>
                <h4>Yesterday&apos;s growth activity</h4>
                <ul className={styles.activityList}>
                  {activity.map((item) => (
                    <li key={item.value}>
                      <i aria-hidden="true" />
                      <span>{item.text}</span>
                      <em>{item.value}</em>
                    </li>
                  ))}
                </ul>
                <div className={styles.recommendation}>
                  <b>{productBrand.name} recommendation:</b> do not copy their broad creator push yet. Test a narrower webinar
                  repurposing wedge, then use response data to decide whether the channel is worth scaling.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={classes("container", "section")} id="cases">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Start anywhere</p>
            <h2>Not a vertical dashboard. A native agentic decision surface.</h2>
          </div>
          <p className={styles.sectionCopy}>
            Start from a competitor, a product that needs believers, or an idea that needs to go live. Each entry
            point keeps going until the tradeoff is clear.
          </p>
        </div>

        <div className={styles.featureGrid}>
          {useCases.map((useCase) => (
            <article className={styles.feature} key={useCase.index}>
              <div className={styles.featureIndex}>{useCase.index}</div>
              <h3>{useCase.title}</h3>
              <p>{useCase.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={classes("container", "section")} id="conversation">
        <div className={styles.conversationGrid}>
          <div className={styles.conversationCopy}>
            <p className={styles.eyebrow}>How it thinks</p>
            <h2>It does not stop at the answer.</h2>
            <p>
              A report gives facts. {productBrand.name} pushes the next question, challenges weak assumptions, and helps you
              choose the move that matches your stage, constraints, and judgment.
            </p>
          </div>

          <div className={styles.dialogStack}>
            <article className={styles.turn}>
              <small>Founder</small>
              <p>Give me a quick competitor update.</p>
            </article>
            <article className={classes("turn", "turnAi")}>
              <small>{productBrand.name}</small>
              <p>Here is the update. More importantly, it creates a decision: defend the same segment or attack the overlooked one.</p>
            </article>
            <article className={styles.turn}>
              <small>Founder</small>
              <p>What would you do if we only have one growth sprint this week?</p>
            </article>
            <article className={classes("turn", "turnAi")}>
              <small>{productBrand.name}</small>
              <p>
                I would run the narrower creator test first. If activation beats your current baseline, then scale. If
                not, the market signal was noise for your stage.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className={classes("container", "section")} id="access">
        <div className={styles.ctaBand}>
          <div>
            <p className={styles.eyebrow}>Start now</p>
            <h2>Bring your startup context into one decision room.</h2>
            <p>
              Start with a competitor, a product, or an idea. {productBrand.name} turns it into the next decision and the next
              action.
            </p>
          </div>
          <div className={styles.ctaActions}>
            <Link className={classes("button", "buttonPrimary", "buttonLarge")} href="/sign-up?method=phone">
              Talk to your AI cofounder
              <ArrowRight aria-hidden="true" size={18} strokeWidth={2} />
            </Link>
            <Link className={classes("button", "buttonLarge")} href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className={classes("container", "section")} id="pricing">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Pricing</p>
            <h2>Usage-based plans for agent work.</h2>
          </div>
          <div className={styles.pricingIntro}>
            <p>
              Credits measure actual agent work and never expire. Annual billing keeps the same workspace limits,
              grants the full year of Credits up front, and gives 20% off the equivalent monthly subscription.
            </p>
            <Link
              className={classes("button", "buttonPrimary")}
              href="/sign-in?method=email&redirect_url=/investor/chat/100"
            >
              Get Started
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
            </Link>
          </div>
        </div>
        <BillingPlanGrid
          getStartedHref="/sign-in?method=email&redirect_url=/investor/chat/100"
          showIntro={false}
          variant="public"
        />
      </section>

      <footer className={styles.footer}>
        <div className={classes("container", "footerInner")}>
          <span>{productBrand.name}</span>
          <span>Your AI cofounder</span>
          <span>Competitive intelligence, seed users, first version.</span>
        </div>
      </footer>
    </main>
  );
}

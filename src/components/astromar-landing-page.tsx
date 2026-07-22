import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./astromar-landing-page.module.css";

const scenarios = [
  {
    lead: "Know competitor moves.",
    decision: "Decide your action.",
    detail:
      "Track competitor activity across all channels. Astromar shows you their playbook and suggests your counter-strategy.",
  },
  {
    lead: "Know what's trending.",
    decision: "Decide what's urgent.",
    detail:
      "What's gaining traction across your platforms? Astromar surfaces trending signals and tells you what deserves attention today.",
  },
  {
    lead: "Find early adopters.",
    decision: "Decide your approach.",
    detail:
      "Find the first users who'll truly care. Astromar helps you identify early adopters and craft the outreach that converts.",
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
    title: "Competitive intelligence",
    copy: '"Opus Clip posted 3 KOC videos yesterday. Two are performing. Here is what they are testing, and the choice it creates for you."',
  },
  {
    index: "02",
    title: "Daily operating judgment",
    copy: '"Your creator account, inbox, and launch thread changed overnight. These are the 3 moves that matter today."',
  },
  {
    index: "03",
    title: "Context-aware communication",
    copy: '"I read the thread, the customer note, and your last decision. Here is the reply that protects the relationship and advances the deal."',
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
          <Link className={styles.brand} href="/" aria-label="Astromar home">
            <span className={styles.brandMark} aria-hidden="true" />
            <span className={styles.brandName}>Astromar</span>
            <span className={styles.brandTagline}>Think with you. Act for you.</span>
          </Link>

          <div className={styles.navLinks} aria-label="Primary navigation">
            <a href="#demo">Demo</a>
            <a href="#cases">Use cases</a>
            <a href="#conversation">How it thinks</a>
          </div>

          <div className={styles.authActions} aria-label="Account actions">
            <Link className={styles.button} href="/sign-in?method=email">
              Sign in
            </Link>
            <Link className={classes("button", "buttonPrimary")} href="/sign-up?method=email">
              Sign up
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
            Astromar turns any signal into a decision conversation.
          </p>
        </div>

        <div className={styles.demoFrame} aria-label="Astromar decision room preview">
          <div className={styles.windowBar}>
            <div className={styles.windowDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={styles.windowTitle}>astromar://decision-room</div>
            <div className={styles.secureContext}>Secure context</div>
          </div>

          <div className={styles.demoBody}>
            <div className={styles.chatPane}>
              <div className={classes("message", "messageUser")}>
                <strong>You</strong>
                What did Opus Clip do yesterday, and should we respond?
              </div>
              <div className={classes("message", "messageAgent")}>
                <strong>Astromar</strong>
                Running cross-channel intelligence across traffic, search, social, and creator activity. I will
                prioritize deltas that change your growth plan today.
              </div>
              <div className={classes("message", "messageAgent")}>
                <strong>Astromar</strong>
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
                  <b>Astromar recommendation:</b> do not copy their broad creator push yet. Test a narrower webinar
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
            Each entry point starts with a real founder question, then keeps going until the tradeoff is clear.
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
              A report gives facts. Astromar pushes the next question, challenges weak assumptions, and helps you
              choose the move that matches your stage, constraints, and judgment.
            </p>
          </div>

          <div className={styles.dialogStack}>
            <article className={styles.turn}>
              <small>Founder</small>
              <p>Give me a quick competitor update.</p>
            </article>
            <article className={classes("turn", "turnAi")}>
              <small>Astromar</small>
              <p>Here is the update. More importantly, it creates a decision: defend the same segment or attack the overlooked one.</p>
            </article>
            <article className={styles.turn}>
              <small>Founder</small>
              <p>What would you do if we only have one growth sprint this week?</p>
            </article>
            <article className={classes("turn", "turnAi")}>
              <small>Astromar</small>
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
              Start with the competitor you cannot ignore. Stay for the decisions you should not make alone.
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

      <footer className={styles.footer}>
        <div className={classes("container", "footerInner")}>
          <span>Astromar</span>
          <span>Your AI cofounder</span>
          <span>Competitive intelligence, decisions, execution.</span>
        </div>
      </footer>
    </main>
  );
}

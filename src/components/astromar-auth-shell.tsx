import type { ReactNode } from "react";
import Link from "next/link";
import {
  BrainCircuit,
  CircleCheck,
  KeyRound,
  Plug,
  Radar,
  ShieldCheck,
} from "lucide-react";
import styles from "./astromar-auth.module.css";

type AstromarAuthShellProps = {
  children: ReactNode;
  emailHref: string;
  method: "email" | "phone";
  mode: "sign-in" | "sign-up";
  phoneHref: string;
};

function Brand() {
  return (
    <Link className={styles.brandLockup} href="/" aria-label="Astromar home">
      <span className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true" />
        <span>Astromar</span>
      </span>
      <span className={styles.brandTagline}>Think with you. Act for you.</span>
    </Link>
  );
}

function SignInPreview() {
  return (
    <div className={styles.decisionRoom}>
      <div className={styles.roomHead}>
        <div>
          <p>Your decision room</p>
          <h2>Pick up exactly where you left off.</h2>
        </div>
        <span className={styles.contextStatus}>Context ready</span>
      </div>

      <div className={styles.roomFrame}>
        <div className={styles.roomBar}>
          <span className={styles.roomDots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Today, 9:41 AM</span>
          <span>Private</span>
        </div>
        <div className={styles.roomBody}>
          <div className={`${styles.message} ${styles.messageYou}`}>
            <small>You</small>
            What changed overnight, and what should I do first?
          </div>
          <div className={styles.message}>
            <small>Astromar</small>
            Three signals matter. One creates a decision you should make before the team starts work.
          </div>
          <div className={styles.signalList}>
            <div className={styles.signal}>
              <i />
              <span><b>Competitor launch:</b> creator bundle shipped</span>
              <span>High signal</span>
            </div>
            <div className={styles.signal}>
              <i />
              <span><b>Activation:</b> onboarding step 3 dropped 11%</span>
              <span>Needs review</span>
            </div>
            <div className={styles.signal}>
              <i />
              <span><b>Pipeline:</b> two founder replies ready</span>
              <span>Actionable</span>
            </div>
          </div>
        </div>
      </div>
      <p className={styles.roomNote}>Your workspace remains private and available across sessions.</p>
    </div>
  );
}

const setupSteps = [
  {
    icon: Radar,
    title: "Analyze one competitor",
    copy: "See their latest moves and the decision it creates for you.",
    status: "Ready now",
    ready: true,
  },
  {
    icon: Plug,
    title: "Connect the context you choose",
    copy: "Bring in Gmail, Slack, Notion, Lark, or your current documents.",
    status: "Optional",
    ready: false,
  },
  {
    icon: BrainCircuit,
    title: "Shape how it thinks with you",
    copy: "Correct recommendations and make every next conversation sharper.",
    status: "Ongoing",
    ready: false,
  },
] as const;

function SignUpPreview() {
  return (
    <div className={styles.onboarding}>
      <div className={styles.onboardingHead}>
        <p>Useful from day one</p>
        <h2>Your first decision room is ready in minutes.</h2>
        <span>
          No setup maze. Start with the question already blocking you, then connect context as it becomes useful.
        </span>
      </div>

      <div className={styles.setupFrame}>
        <div className={styles.setupBar}>
          <strong>Your first session</strong>
          <span>Private workspace</span>
        </div>
        <div className={styles.setupList}>
          {setupSteps.map(({ icon: Icon, title, copy, status, ready }) => (
            <div className={styles.setupStep} key={title}>
              <span className={styles.stepIcon}><Icon size={18} /></span>
              <span className={styles.stepCopy}>
                <b>{title}</b>
                <span>{copy}</span>
              </span>
              <span className={`${styles.stepStatus} ${ready ? styles.stepStatusReady : ""}`}>{status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.trustRow}>
        <span><ShieldCheck size={15} />Private by default</span>
        <span><KeyRound size={15} />You control connections</span>
        <span><CircleCheck size={15} />Cancel anytime</span>
      </div>
    </div>
  );
}

export function AstromarAuthShell({
  children,
  emailHref,
  method,
  mode,
  phoneHref,
}: AstromarAuthShellProps) {
  const isSignIn = mode === "sign-in";

  return (
    <main className={styles.authPage}>
      <header className={styles.topbar}>
        <Brand />
        <div className={styles.topAction}>
          <span>{isSignIn ? "New to Astromar?" : "Already have an account?"}</span>
          <Link href={isSignIn ? "/sign-up?method=email" : "/sign-in?method=email"}>
            {isSignIn ? "Create account" : "Sign in"}
          </Link>
        </div>
      </header>

      <div className={styles.layout}>
        <section className={styles.authSide}>
          <div className={styles.authWrap}>
            <p className={`${styles.eyebrow} ${isSignIn ? styles.eyebrowSignIn : ""}`}>
              {isSignIn ? "Welcome back" : "Get started"}
            </p>
            <h1>{isSignIn ? "Continue with your AI cofounder." : "Build your AI cofounder."}</h1>
            <p className={styles.intro}>
              {isSignIn
                ? "Your context, decisions, and active work are ready when you are."
                : "Start with one decision. Bring in more context when you are ready."}
            </p>

            <nav className={styles.modeTabs} aria-label="Authentication method">
              <Link className={method === "email" ? styles.modeTabActive : styles.modeTab} href={emailHref}>
                Email / Google
              </Link>
              <Link className={method === "phone" ? styles.modeTabActive : styles.modeTab} href={phoneHref}>
                Phone / password
              </Link>
            </nav>

            <div className={styles.authContent}>{children}</div>
          </div>
        </section>

        <aside className={styles.productSide} aria-label="Astromar product preview">
          {isSignIn ? <SignInPreview /> : <SignUpPreview />}
        </aside>
      </div>
    </main>
  );
}

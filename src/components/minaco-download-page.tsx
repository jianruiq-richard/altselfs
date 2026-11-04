'use client';

import Link from 'next/link';
import { Check, Download, ExternalLink, Laptop, ShieldCheck } from 'lucide-react';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import type { PublicRelease } from '@/lib/minaco-product-catalog';
import styles from './minaco-download-page.module.css';

export function MinacoDownloadPage({
  release,
  workspace,
}: {
  release: PublicRelease | null;
  workspace: string | null;
}) {
  const version = release?.version || 'latest';
  const downloadUrl = release?.url || null;

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.wordmark} href="/" aria-label="Minaco home">
        <MinacoBrandMark className={styles.mark} imageClassName={styles.markImage} />
        <span>Minaco</span>
      </Link>
      <nav><Link href="/pricing">Pricing</Link><Link href="/sign-in">Log in</Link></nav>
    </header>

    <section className={styles.hero}>
      <div className={styles.copy}>
        <h1>Download the workspace</h1>
        <p>Install Minaco on your Mac. Your account connects in the browser and returns you to the same workspace.</p>
        {workspace ? <p className={styles.workspaceNote}>Ready to create “{workspace}” after sign-in.</p> : null}
        {downloadUrl ? <a
          className={styles.downloadButton}
          href={downloadUrl}
          data-analytics-cta="download_macos_dmg"
          data-analytics-location="download_page"
        >
          <Download size={19} /> Download Minaco {version}
        </a> : <span className={styles.unavailable}>The signed release is temporarily unavailable. Please try again shortly.</span>}
        <div className={styles.releaseMeta}>
          <span>For Apple silicon · macOS 13 or later</span>
          {release ? <span>{formatBytes(release.bytes)} · Signed and notarized</span> : null}
        </div>
      </div>

      <div className={styles.installer} data-ui>
        <div className={styles.installerBar}><span /><span /><span /><strong>Minaco {version}</strong></div>
        <div className={styles.installerBody}>
          <div className={styles.appIcon}><MinacoBrandMark imageClassName={styles.appIconImage} variant="appIcon" /><span>Minaco</span></div>
          <div className={styles.installArrow}><span>drag to install</span><strong>→</strong></div>
          <div className={styles.applications}><Laptop size={38} /><span>Applications</span></div>
        </div>
        <div className={styles.trustLine}><ShieldCheck size={16} /> Apple notarization verified before release</div>
      </div>
    </section>

    <section className={styles.steps} aria-labelledby="install-title">
      <div>
        <h2 id="install-title">From download to first message</h2>
        <p>The browser is used only to authenticate your Minaco account. The app keeps the workspace open while you sign in.</p>
      </div>
      <ol>
        <li><strong>Move Minaco to Applications</strong><span>Open the DMG and drag Minaco into the Applications folder.</span></li>
        <li><strong>Open Minaco</strong><span>macOS verifies the signed app. Choose Open if it asks for confirmation.</span></li>
        <li><strong>Connect your account</strong><span>Minaco opens a secure browser page and returns to the app after sign-in.</span></li>
        <li><strong>Start the work</strong><span>Create a workspace, choose an Agent, and send the first message.</span></li>
      </ol>
    </section>

    <section className={styles.returnBlock}>
      <div>
        <h2>Already installed?</h2>
        <p>Bring Minaco to the front, then connect or refresh your account inside the app.</p>
      </div>
      <a href="minaco://auth/complete" data-analytics-cta="open_installed_minaco" data-analytics-location="download_page">
        Open Minaco <ExternalLink size={16} />
      </a>
    </section>

    <footer className={styles.footer}>
      <span>Minaco Desktop {version}</span>
      <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Help</Link></div>
      <span>{release ? <><Check size={14} /> Release manifest verified</> : 'Release status unavailable'}</span>
    </footer>
  </main>;
}

function formatBytes(value: number) {
  return `${Math.round(value / 1024 / 1024)} MB`;
}

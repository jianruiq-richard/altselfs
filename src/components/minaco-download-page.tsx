import type { PublicRelease } from '@/lib/minaco-product-catalog';
import { MinacoAuthFrame } from './minaco-auth-frame';
import styles from './minaco-auth-frame.module.css';

export function MinacoDownloadPage({ release, workspace }: { release: PublicRelease | null; workspace: string | null }) {
  return <MinacoAuthFrame title="Install Minaco Desktop." description="Your agents, tools, and connected apps. Together on your Mac.">
    {release ? <>
      <a className={styles.primary} href="/api/download" data-analytics-cta="download_macos_dmg" data-analytics-location="download_page">Download for Mac ↓</a>
      <p className={styles.note}>Version {release.version} · {Math.round(release.bytes / 1024 / 1024)} MB<br />Apple silicon · macOS 13 or later · Signed and notarized</p>
    </> : <p className={styles.note} role="status">The download is temporarily unavailable. Please refresh this page in a moment.</p>}
    {workspace ? <p className={styles.note}>Your next workspace: “{workspace}”</p> : null}
    <ol className={styles.steps}>
      <li><div><strong>Drag Minaco into Applications</strong><p>Open the downloaded DMG and move Minaco to your Applications folder.</p></div></li>
      <li><div><strong>Connect your account</strong><p>Open Minaco and choose “Connect Minaco account”. Sign in or create your account in the browser, then confirm the connection.</p></div></li>
      <li><div><strong>Start your first project</strong><p>Return to Minaco Desktop. Create a workspace, choose an agent, and send your first message.</p></div></li>
    </ol>
    <a className={styles.secondary} href="minaco://auth/complete" data-analytics-cta="open_installed_minaco" data-analytics-location="download_page">Already installed? Open Minaco Desktop</a>
    <details className={styles.recovery}><summary>The app didn’t open</summary><p>Open Minaco from your Applications folder. On a phone or another computer? Visit minaco.ai on your Mac to finish installation.</p></details>
  </MinacoAuthFrame>;
}

import type { ReactNode } from 'react';
import { MinacoAuthFrame } from './minaco-auth-frame';
import styles from './minaco-auth-frame.module.css';
export function DesktopAuthShell({ children, description, title }: { children?: ReactNode; description: string; step: 1 | 2 | 3; title: string }) {
  return <MinacoAuthFrame title={title} description={description}>{children}</MinacoAuthFrame>;
}
export function InvalidDesktopRequest() {
  return <DesktopAuthShell step={1} title="Start a new sign-in." description="This sign-in link is invalid. Return to Minaco Desktop and choose “Connect Minaco account” to start again.">
    <a className={styles.primary} href="minaco://auth/complete">Open Minaco Desktop</a>
    <details className={styles.recovery}><summary>The app didn’t open</summary><p>Open Minaco from your Applications folder, then choose “Connect Minaco account”.</p></details>
  </DesktopAuthShell>;
}

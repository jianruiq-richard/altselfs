'use client';

import { useEffect, useState } from 'react';
import type { PublicRelease } from '@/lib/minaco-product-catalog';
import styles from './minaco-download-page.module.css';

type Architecture = 'arm64' | 'x64';
type NavigatorWithUAData = Navigator & {
  userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };
};

export function MacDownloadOptions({ releases }: { releases: PublicRelease[] }) {
  const [detected, setDetected] = useState<Architecture | null>(null);
  const appleSilicon = releases.find((release) => release.platform === 'darwin-arm64');
  const intel = releases.find((release) => release.platform === 'darwin-x64');

  useEffect(() => {
    const uaData = (navigator as NavigatorWithUAData).userAgentData;
    uaData?.getHighEntropyValues?.(['architecture']).then(({ architecture }) => {
      const value = architecture?.toLowerCase();
      if (value && ['x86', 'x86_64', 'amd64'].includes(value)) setDetected('x64');
      if (value && ['arm', 'arm64', 'aarch64'].includes(value)) setDetected('arm64');
    }).catch(() => undefined);
  }, []);

  return <div className={styles.options} aria-label="Choose your Mac processor">
    {appleSilicon ? <DownloadOption architecture="arm64" title="Apple silicon Mac" detail="M1, M2, M3, M4, or M5" release={appleSilicon} recommended={detected === 'arm64'} /> : null}
    {intel ? <DownloadOption architecture="x64" title="Intel Mac" detail="Intel Core processor" release={intel} recommended={detected === 'x64'} /> : null}
  </div>;
}

function DownloadOption({ architecture, title, detail, release, recommended }: {
  architecture: Architecture;
  title: string;
  detail: string;
  release: PublicRelease;
  recommended: boolean;
}) {
  return <a
    className={styles.option}
    data-recommended={recommended || undefined}
    href={`/api/download?arch=${architecture}`}
    data-analytics-cta={`download_macos_${architecture}_dmg`}
    data-analytics-location="download_page"
  >
    <span><strong>{title}</strong><small>{detail} · {Math.round(release.bytes / 1024 / 1024)} MB</small></span>
    <span className={styles.optionAction}>{recommended ? 'Recommended · ' : ''}Download ↓</span>
  </a>;
}

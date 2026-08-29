import styles from "./astromar-auth.module.css";

const REPORT_URL = "/demo/checkvibe-competitor-analysis.html";

export function AuthReportCarousel() {
  return (
    <div className={styles.reportDemo}>
      <div className={styles.reportDemoHeader}>
        <div>
          <span className={styles.reportLiveDot} aria-hidden="true" />
          Competitor intelligence report
        </div>
        <strong>CheckVibe.dev</strong>
      </div>

      <div className={styles.reportViewport}>
        <iframe
          className={styles.reportFrame}
          src={REPORT_URL}
          title="CheckVibe competitor analysis report preview"
          sandbox="allow-scripts"
          tabIndex={-1}
        />
        <div className={styles.reportPageShade} aria-hidden="true" />
      </div>

      <div className={styles.reportControls}>
        <span className={styles.reportAutoStatus}>
          <i aria-hidden="true" />
          Auto-scrolling report
        </span>
        <div className={styles.reportProgress} aria-hidden="true">
          <i />
        </div>
        <span>Revenue first</span>
      </div>
    </div>
  );
}

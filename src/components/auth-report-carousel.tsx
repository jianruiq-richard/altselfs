"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import styles from "./astromar-auth.module.css";

const SLIDE_INTERVAL_MS = 6000;
const months = ["Feb", "Mar", "Apr", "May", "Jun", "Jul"];

const trafficValues = [12030, 15639, 20331, 26430, 43739, 42837];
const revenueValues = [671, 1275, 1899, 2614, 4008, 3300];

const trafficSources = [
  ["Direct", 50.89],
  ["Organic Social", 24.5],
  ["Organic Search", 17.5],
  ["Referrals", 3.58],
] as const;

const countries = [
  ["India", 31.55],
  ["United States", 17.48],
  ["Brazil", 6.62],
  ["Germany", 6],
  ["United Kingdom", 5.39],
] as const;

const pricing = [
  ["Free", "$0", "1 project · 4 scans/month"],
  ["Starter", "$24/mo", "Full findings · AI remediation · exports"],
  ["Pro", "$49/mo", "Scheduled rescans · API · higher limits"],
  ["Team Basic", "$25/seat", "Collaboration · PR reviews · audit logs"],
  ["Team Advanced", "$50/seat", "SSO · merge gates · custom rules"],
] as const;

function TrendChart({ values, color, label }: { values: number[]; color: string; label: string }) {
  const width = 520;
  const height = 118;
  const padX = 18;
  const padTop = 12;
  const padBottom = 25;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = padX + (index * (width - padX * 2)) / (values.length - 1);
    const y = padTop + ((max - value) * (height - padTop - padBottom)) / range;
    return { x, y };
  });

  return (
    <svg className={styles.reportTrendChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} />
      <polyline points={points.map(({ x, y }) => `${x},${y}`).join(" ")} style={{ stroke: color }} />
      {points.map(({ x, y }, index) => (
        <g key={months[index]}>
          <circle cx={x} cy={y} r="4" style={{ fill: color }} />
          <text x={x} y={height - 7} textAnchor="middle">{months[index]}</text>
        </g>
      ))}
    </svg>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={styles.reportMetricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function RevenueSlide() {
  return (
    <article className={styles.reportSlide}>
      <header className={styles.reportSlideHead}>
        <p>Revenue overview</p>
        <h2>CheckVibe revenue and paying users</h2>
      </header>
      <div className={styles.reportMetricGrid}>
        <Metric label="Calibrated July Revenue" value="$3.3k" note="Monthly revenue estimate" />
        <Metric label="Calibrated Paying Users" value="100" note="Aligned with public signals" />
        <Metric label="Public Revenue Signal" value="~$3k MRR" note="Reported after six weeks" />
      </div>
      <div className={styles.reportChartCard}>
        <div className={styles.reportChartCopy}>
          <h3>Six-month revenue trend</h3>
          <strong>$671 → $3,300</strong>
          <span>Calibrated estimate, Feb–Jul</span>
        </div>
        <TrendChart values={revenueValues} color="#E86F61" label="Six-month calibrated revenue trend" />
      </div>
      <p className={styles.reportSource}>Source: public Reddit revenue signal, pricing data, and calibrated traffic model.</p>
    </article>
  );
}

function TrafficSlide() {
  return (
    <article className={styles.reportSlide}>
      <header className={styles.reportSlideHead}>
        <p>Traffic & users</p>
        <h2>Traffic grew sharply, then leveled off in July</h2>
      </header>
      <div className={styles.reportMetricGrid}>
        <Metric label="July Visits" value="42,837" note="Similarweb estimate" />
        <Metric label="Estimated July Users" value="8,567" note="20% of visits" />
        <Metric label="Feb–Jul Visit Growth" value="+256%" note="12,030 → 42,837" />
      </div>
      <div className={styles.reportChartCard}>
        <div className={styles.reportChartCopy}>
          <h3>Monthly visits</h3>
          <strong>43,739 peak</strong>
          <span>June peak, slight July decline</span>
        </div>
        <TrendChart values={trafficValues} color="#F2C36B" label="Monthly visits from February through July" />
      </div>
      <p className={styles.reportSource}>Source: Similarweb estimates; user count calculated as 20% of visits.</p>
    </article>
  );
}

function ChannelsSlide() {
  return (
    <article className={styles.reportSlide}>
      <header className={styles.reportSlideHead}>
        <p>Acquisition channels</p>
        <h2>Direct and organic social drive most discovery</h2>
      </header>
      <div className={styles.reportChannelLayout}>
        <div className={styles.reportShareDonut} aria-label="Direct traffic accounts for 50.89 percent">
          <span><strong>50.89%</strong><small>Direct</small></span>
        </div>
        <div className={styles.reportBars}>
          {trafficSources.map(([label, value]) => (
            <div className={styles.reportBar} key={label}>
              <span>{label}</span>
              <i><b style={{ width: `${value}%` }} /></i>
              <strong>{value.toFixed(2)}%</strong>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.reportCallout}>
        Direct and Organic Social exceed 75%, pointing to branded demand, community distribution, and creator content rather than large-scale paid acquisition.
      </div>
      <p className={styles.reportSource}>Other channels: Display Ads 1.41% · GenAI 1.33% · Mail 0.78%.</p>
    </article>
  );
}

function AcquisitionSlide() {
  return (
    <article className={styles.reportSlide}>
      <header className={styles.reportSlideHead}>
        <p>Promotion tactics</p>
        <h2>Community posts and creator incentives are the clearest growth engine</h2>
      </header>
      <div className={styles.reportFeatureGrid}>
        <div className={styles.reportFeatureCard}>
          <span>Reddit</span>
          <h3>Founder-style revenue story</h3>
          <p>Recent post highlighted roughly $3k revenue, 100+ paying customers, and 2.5k+ signups after six weeks.</p>
        </div>
        <div className={styles.reportFeatureCard}>
          <span>Affiliate / creator program</span>
          <h3>Pay creators where content converts</h3>
          <p>30% of first payment, a $50 minimum payout, and pay-per-view incentives focused on TikTok and Reddit.</p>
        </div>
      </div>
      <div className={styles.reportStatusRow}>
        <span><i />X: no recent posts</span>
        <span><i />Instagram: no recent posts</span>
        <span><i />TikTok: no account found</span>
        <span><i />YouTube: no official channel resolved</span>
      </div>
      <p className={styles.reportSource}>Source: recent Reddit crawl, official affiliate page, and official social account checks.</p>
    </article>
  );
}

function PricingSlide() {
  return (
    <article className={styles.reportSlide}>
      <header className={styles.reportSlideHead}>
        <p>Pricing & monetization</p>
        <h2>Clear upgrade path from free scans to team controls</h2>
      </header>
      <div className={styles.reportPricingTable} role="table" aria-label="CheckVibe pricing plans">
        {pricing.map(([plan, price, detail]) => (
          <div role="row" key={plan}>
            <strong role="cell">{plan}</strong>
            <b role="cell">{price}</b>
            <span role="cell">{detail}</span>
          </div>
        ))}
      </div>
      <div className={styles.reportCallout}>
        Public signals indicate early commercial validation. Stripe, Apple Pay, and Google Pay are listed as payment options.
      </div>
      <p className={styles.reportSource}>Source: official pricing page and public revenue claims.</p>
    </article>
  );
}

function GeographySlide() {
  return (
    <article className={styles.reportSlide}>
      <header className={styles.reportSlideHead}>
        <p>Audience & engagement</p>
        <h2>India leads traffic while engagement remains shallow</h2>
      </header>
      <div className={styles.reportGeoLayout}>
        <div className={styles.reportBars}>
          {countries.map(([label, value]) => (
            <div className={styles.reportBar} key={label}>
              <span>{label}</span>
              <i><b style={{ width: `${value * 2.7}%` }} /></i>
              <strong>{value.toFixed(2)}%</strong>
            </div>
          ))}
        </div>
        <div className={styles.reportEngagementGrid}>
          <Metric label="Bounce Rate" value="45.6%" note="Moderately high" />
          <Metric label="Pages / Visit" value="1.75" note="Low visit depth" />
          <Metric label="Time on Site" value="13.7s" note="Very short sessions" />
        </div>
      </div>
      <div className={styles.reportCallout}>
        The audience is geographically broad, but short sessions suggest that activation and repeat use still need validation.
      </div>
      <p className={styles.reportSource}>Source: Similarweb geography and engagement estimates.</p>
    </article>
  );
}

function AssessmentSlide() {
  return (
    <article className={styles.reportSlide}>
      <header className={styles.reportSlideHead}>
        <p>Competitive assessment</p>
        <h2>What the signals say about CheckVibe</h2>
      </header>
      <div className={styles.reportAssessmentGrid}>
        <div><span>Acquisition advantage</span><strong>Community distribution</strong><p>Reddit, TikTok creator incentives, and branded demand appear to power growth.</p></div>
        <div><span>Monetization signal</span><strong>Early paid validation</strong><p>Clear pricing and public paying-customer signals support a real revenue story.</p></div>
        <div><span>Defensive weakness</span><strong>Durability is unproven</strong><p>Short sessions, small official audiences, and limited SEO coverage need validation.</p></div>
      </div>
      <div className={styles.reportConclusion}>
        <span>Key takeaway</span>
        <p>CheckVibe appears strongest at turning community attention into early paid demand. Its next challenge is proving retention and repeatable acquisition beyond founder-led distribution.</p>
      </div>
      <p className={styles.reportSource}>Third-party traffic and SEO figures are directional estimates, not financial facts.</p>
    </article>
  );
}

const slides = [
  RevenueSlide,
  TrafficSlide,
  ChannelsSlide,
  AcquisitionSlide,
  PricingSlide,
  GeographySlide,
  AssessmentSlide,
];

export function AuthReportCarousel() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHovering, setIsHovering] = useState(false);
  const ActiveSlide = slides[activeSlide];

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pauseForReducedMotion = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setIsPlaying(false);
    };
    const initialCheck = window.setTimeout(() => pauseForReducedMotion(prefersReducedMotion), 0);
    prefersReducedMotion.addEventListener("change", pauseForReducedMotion);

    return () => {
      window.clearTimeout(initialCheck);
      prefersReducedMotion.removeEventListener("change", pauseForReducedMotion);
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || isHovering) return;
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % slides.length);
    }, SLIDE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isHovering, isPlaying]);

  const showSlide = (slide: number) => {
    setActiveSlide((slide + slides.length) % slides.length);
  };

  return (
    <div
      className={styles.reportDemo}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className={styles.reportDemoHeader}>
        <div><span className={styles.reportLiveDot} aria-hidden="true" />Competitor intelligence report</div>
        <strong>CheckVibe.dev</strong>
      </div>

      <div className={styles.reportViewport} aria-live="polite">
        <ActiveSlide />
      </div>

      <div className={styles.reportControls}>
        <button type="button" onClick={() => showSlide(activeSlide - 1)} aria-label="Previous report slide"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => setIsPlaying((current) => !current)} aria-label={isPlaying ? "Pause report autoplay" : "Play report autoplay"}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span>Page {activeSlide + 1} of {slides.length}</span>
        <div className={styles.reportProgress} aria-hidden="true"><i style={{ width: `${((activeSlide + 1) / slides.length) * 100}%` }} /></div>
        <button type="button" onClick={() => showSlide(activeSlide + 1)} aria-label="Next report slide"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import puppeteer from "puppeteer-core";

const PROFILE_ID = "k1i0vu5h";
const API_PORT = "50325";
const CONFIG_PATH = "/Users/richardjian/.codex/config.toml";
const MANUAL_SESSION_MARKER_PATH = "/tmp/com.altselfs.adspower-reddit-reader-manual-date";
const LATEST_START_MINUTES = 4 * 60 + 45;
const TOPICS = [
  "indie developer bootstrap SaaS",
  "founder startup lessons learned",
  "AI agent product builders",
  "build in public revenue",
  "SaaS product development",
  "solo founder distribution",
  "AI startup validation",
];

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function randomInteger(minimum, maximum) {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function hasManualSessionToday() {
  return (
    existsSync(MANUAL_SESSION_MARKER_PATH) &&
    readFileSync(MANUAL_SESSION_MARKER_PATH, "utf8").trim() === shanghaiDate()
  );
}

function markManualSessionToday() {
  writeFileSync(MANUAL_SESSION_MARKER_PATH, `${shanghaiDate()}\n`, "utf8");
}

function readApiKey() {
  const config = readFileSync(CONFIG_PATH, "utf8");
  const section = config.match(
    /\[mcp_servers\.adspower-local-api\.env\]([\s\S]*?)(?=\n\[|$)/,
  );
  const key = section?.[1].match(/^API_KEY\s*=\s*"([^"]+)"/m)?.[1];
  if (!key) {
    throw new Error("AdsPower API key is not configured in Codex.");
  }
  return key;
}

async function openProfile(apiKey) {
  const response = await fetch(
    `http://127.0.0.1:${API_PORT}/api/v1/browser/start?user_id=${encodeURIComponent(PROFILE_ID)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.code !== 0 || !payload?.data?.ws?.puppeteer) {
    throw new Error("AdsPower did not return a browser debugging endpoint.");
  }
  return payload.data.ws.puppeteer;
}

async function assertSignedIn(page) {
  const blocked = await page.evaluate(() => ({
    login: Boolean(
      document.querySelector(
        'form[action*="login"], input[name="username"], input[name="password"]',
      ),
    ),
    captcha: /captcha|verify you are human/i.test(document.body.innerText),
  }));
  if (blocked.login || blocked.captcha) {
    throw new Error(blocked.captcha ? "CAPTCHA_REQUIRED" : "LOGIN_REQUIRED");
  }
}

async function getRedditPage(browser) {
  const pages = await browser.pages();
  return pages.find((page) => page.url().includes("reddit.com")) ?? browser.newPage();
}

async function readOnlySession({ durationMinutes, markManualSession }) {
  const apiKey = readApiKey();
  const browser = await puppeteer.connect({
    browserWSEndpoint: await openProfile(apiKey),
  });
  try {
    const page = await getRedditPage(browser);
    await page.bringToFront();
    const deadline = Date.now() + durationMinutes * 60_000;
    let visitedPosts = 0;

    while (Date.now() < deadline) {
      const topic = TOPICS[randomInteger(0, TOPICS.length - 1)];
      await page.goto(
        `https://www.reddit.com/search/?q=${encodeURIComponent(topic)}&sort=relevance&t=year`,
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );
      await assertSignedIn(page);
      if (markManualSession) {
        markManualSessionToday();
        markManualSession = false;
      }
      await sleep(randomInteger(12, 22) * 1000);
      await page.evaluate(() =>
        window.scrollBy({ top: Math.max(450, window.innerHeight * 0.7), behavior: "smooth" }),
      );

      const posts = await page.$$eval('a[href*="/comments/"]', (anchors) =>
        [...new Set(anchors.map((anchor) => anchor.href))].filter((href) =>
          href.startsWith("https://www.reddit.com/"),
        ),
      );
      if (posts.length === 0) {
        continue;
      }

      await page.goto(posts[randomInteger(0, Math.min(4, posts.length - 1))], {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await assertSignedIn(page);
      await sleep(randomInteger(25, 48) * 1000);
      await page.evaluate(() =>
        window.scrollBy({ top: Math.max(650, window.innerHeight * 0.9), behavior: "smooth" }),
      );
      visitedPosts += 1;
    }

    console.log(JSON.stringify({ status: "completed", visitedPosts, title: await page.title() }));
  } finally {
    await browser.disconnect();
  }
}

const argumentsSet = new Set(process.argv.slice(2));
const durationFlag = process.argv.indexOf("--duration-minutes");
const requestedDuration = durationFlag >= 0 ? Number(process.argv[durationFlag + 1]) : null;
const durationMinutes = Number.isFinite(requestedDuration)
  ? requestedDuration
  : randomInteger(10, 15);

const isManualRun = argumentsSet.has("--now");

if (!isManualRun) {
  if (hasManualSessionToday()) {
    console.log(JSON.stringify({ status: "skipped", reason: "manual_session_today" }));
    process.exit(0);
  }
  const delayMinutes = randomInteger(0, LATEST_START_MINUTES);
  const scheduledStart = new Date(Date.now() + delayMinutes * 60_000);
  console.log(
    JSON.stringify({
      status: "waiting",
      scheduledStart: scheduledStart.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }),
    }),
  );
  await sleep(delayMinutes * 60_000);
  if (hasManualSessionToday()) {
    console.log(JSON.stringify({ status: "skipped", reason: "manual_session_today" }));
    process.exit(0);
  }
}

await readOnlySession({ durationMinutes, markManualSession: isManualRun });

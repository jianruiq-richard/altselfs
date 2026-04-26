const PAGE_SOURCE = 'altselfs_xhs_page';
const AUTH_COOKIE_NAMES = ['a1', 'web_session', 'webId'];
const PROBE_URL = 'https://edith.xiaohongshu.com/api/sns/web/v2/user/me';
const XHS_COOKIE_QUERIES = [
  { url: 'https://xiaohongshu.com/' },
  { url: 'https://www.xiaohongshu.com/' },
  { url: 'https://edith.xiaohongshu.com/' },
  { domain: 'xiaohongshu.com' },
  { domain: 'www.xiaohongshu.com' },
  { domain: 'edith.xiaohongshu.com' },
];

async function getCookiesForQuery(query) {
  const cookies = await chrome.cookies.getAll(query);
  return cookies.map((item) => ({
    name: item.name,
    value: item.value,
    domain: item.domain,
    path: item.path,
    secure: item.secure,
    httpOnly: item.httpOnly,
    session: item.session,
    storeId: item.storeId,
  }));
}

async function collectCookieGroups() {
  const groups = await Promise.all(XHS_COOKIE_QUERIES.map((query) => getCookiesForQuery(query)));
  const merged = new Map();
  for (const group of groups) {
    for (const item of group) {
      merged.set(`${item.domain}|${item.path}|${item.name}`, item);
    }
  }
  return Array.from(merged.values());
}

async function getCookieString() {
  const cookies = await collectCookieGroups();
  return cookies.map((item) => `${item.name}=${item.value}`).join('; ');
}

function parseCookieHeader(cookieHeader) {
  if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) return [];
  return cookieHeader
    .split(/;\s*/)
    .map((segment) => {
      const index = segment.indexOf('=');
      if (index <= 0) return null;
      return {
        name: segment.slice(0, index),
        value: segment.slice(index + 1),
        domain: 'request_header',
        path: '/',
        secure: true,
        httpOnly: true,
        session: true,
        storeId: 'request_header',
      };
    })
    .filter(Boolean);
}

function hasSupportedAuthCookie(input) {
  if (Array.isArray(input)) {
    return input.some((item) => AUTH_COOKIE_NAMES.includes(item.name));
  }
  if (typeof input === 'string') {
    return AUTH_COOKIE_NAMES.some((name) => input.includes(`${name}=`));
  }
  return false;
}

function mergeCookies(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const item of group) {
      merged.set(`${item.domain}|${item.path}|${item.name}`, item);
    }
  }
  return Array.from(merged.values());
}

async function probeCookieHeader() {
  if (!chrome.webRequest?.onBeforeSendHeaders) return '';

  return await new Promise((resolve) => {
    let done = false;
    const requestUrl = `${PROBE_URL}?_=${Date.now()}`;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
      } catch {}
      resolve(value);
    };

    const onBeforeSendHeaders = (details) => {
      if (!details.url.startsWith(PROBE_URL)) return;
      const cookieHeader =
        details.requestHeaders?.find((header) => header.name.toLowerCase() === 'cookie')?.value || '';
      finish(cookieHeader);
    };

    const timer = setTimeout(() => finish(''), 5000);
    chrome.webRequest.onBeforeSendHeaders.addListener(
      onBeforeSendHeaders,
      { urls: [`${PROBE_URL}*`] },
      ['requestHeaders', 'extraHeaders']
    );

    fetch(requestUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'application/json, text/plain, */*',
      },
    })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => finish(''), 1500);
      });
  });
}

function buildDebugPayload(cookies) {
  const byDomain = cookies.reduce((acc, item) => {
    const key = item.domain || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item.name);
    return acc;
  }, {});
  const authCookieNames = Array.from(
    new Set(cookies.filter((item) => AUTH_COOKIE_NAMES.includes(item.name)).map((item) => item.name))
  ).sort();

  return {
    ok: true,
    cookieCount: cookies.length,
    hasA1: cookies.some((item) => item.name === 'a1'),
    hasSupportedAuthCookie: hasSupportedAuthCookie(cookies),
    authCookieNames,
    cookieNames: Array.from(new Set(cookies.map((item) => item.name))).sort(),
    queryTargets: XHS_COOKIE_QUERIES.map((query) => ('url' in query ? `url:${query.url}` : `domain:${query.domain}`)),
    cookiesByDomain: Object.fromEntries(
      Object.entries(byDomain)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([domain, names]) => [domain, Array.from(new Set(names)).sort()])
    ),
  };
}

async function fetchAccountName() {
  try {
    const res = await fetch('https://edith.xiaohongshu.com/api/sns/web/v2/user/me', {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
      },
    });
    const data = await res.json();
    const profile = data?.data || {};
    return profile.nickname || profile.nick_name || profile.name || '小红书浏览器授权';
  } catch {
    return '小红书浏览器授权';
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.source !== PAGE_SOURCE) return;

  (async () => {
    if (message.type === 'XHS_EXTENSION_PING') {
      sendResponse({ ok: true, installed: true });
      return;
    }

    if (message.type === 'XHS_EXTENSION_CONNECT') {
      const baseCookies = await collectCookieGroups();
      const probedHeader = !baseCookies.some((item) => item.name === 'a1') ? await probeCookieHeader() : '';
      const probedCookies = parseCookieHeader(probedHeader);
      const mergedCookies = mergeCookies(baseCookies, probedCookies);
      const cookies = mergedCookies.map((item) => `${item.name}=${item.value}`).join('; ');
      if (!cookies || !hasSupportedAuthCookie(mergedCookies)) {
        sendResponse({
          ok: false,
          error: '未读取到可用的小红书网页登录态。请先确认当前浏览器已登录网页版小红书，再重试。',
          debug: {
            ...buildDebugPayload(mergedCookies),
            probeHasA1: probedCookies.some((item) => item.name === 'a1'),
          },
        });
        return;
      }

      const accountName = await fetchAccountName();
      sendResponse({
        ok: true,
        cookies,
        accountName,
      });
      return;
    }

    if (message.type === 'XHS_EXTENSION_DEBUG') {
      const baseCookies = await collectCookieGroups();
      const probedHeader = !baseCookies.some((item) => item.name === 'a1') ? await probeCookieHeader() : '';
      const probedCookies = parseCookieHeader(probedHeader);
      const cookies = mergeCookies(baseCookies, probedCookies);
      sendResponse({
        ...buildDebugPayload(cookies),
        probeCookieNames: Array.from(new Set(probedCookies.map((item) => item.name))).sort(),
        probeHasA1: probedCookies.some((item) => item.name === 'a1'),
      });
      return;
    }

    sendResponse({ ok: false, error: `Unsupported message type: ${message.type}` });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : '扩展执行失败',
    });
  });

  return true;
});

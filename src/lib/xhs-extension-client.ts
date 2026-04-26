'use client';

type ExtensionResponsePayload = {
  ok?: boolean;
  installed?: boolean;
  cookies?: string;
  accountName?: string;
  debug?: unknown;
  error?: string;
};

type BridgeEnvelope = {
  source: 'altselfs_xhs_extension';
  type: string;
  requestId: string;
  payload?: ExtensionResponsePayload;
};

const PAGE_SOURCE = 'altselfs_xhs_page';
const EXTENSION_SOURCE = 'altselfs_xhs_extension';

function randomId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sendBridgeRequest<T extends ExtensionResponsePayload>(type: string, timeoutMs = 4000) {
  return new Promise<T>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('当前环境不支持浏览器扩展通信'));
      return;
    }

    const requestId = randomId();
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };

    const onMessage = (event: MessageEvent<BridgeEnvelope>) => {
      const data = event.data;
      if (!data || data.source !== EXTENSION_SOURCE || data.requestId !== requestId) return;
      settled = true;
      cleanup();
      resolve((data.payload || {}) as T);
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error('未检测到小红书扩展响应，请先安装并刷新页面'));
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type,
        requestId,
      },
      window.location.origin
    );
  });
}

export async function detectXhsExtension() {
  const result = await sendBridgeRequest<{ installed?: boolean }>('XHS_EXTENSION_PING', 1500).catch(() => ({
    installed: false,
  }));
  return Boolean(result.installed);
}

export async function connectXhsExtension() {
  const result = await sendBridgeRequest<ExtensionResponsePayload>('XHS_EXTENSION_CONNECT', 8000);
  if (!result.ok || !result.cookies) {
    const error = new Error(result.error || '浏览器扩展未返回有效登录态') as Error & { debug?: unknown };
    error.debug = result.debug;
    throw error;
  }
  return {
    cookies: result.cookies,
    accountName: result.accountName || '小红书浏览器授权',
  };
}

export async function debugXhsExtension() {
  return sendBridgeRequest<{
    ok?: boolean;
    cookieCount?: number;
    hasA1?: boolean;
    cookieNames?: string[];
    cookiesByDomain?: Record<string, string[]>;
    error?: string;
  }>('XHS_EXTENSION_DEBUG', 5000);
}

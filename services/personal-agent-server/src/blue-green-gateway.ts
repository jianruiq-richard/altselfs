import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';

export type DeploymentColor = 'blue' | 'green';

export type BlueGreenGatewayOptions = {
  activeColorFile: string;
  blueUpstream: string;
  greenUpstream: string;
  healthTimeoutMs?: number;
};

export function createBlueGreenGateway(options: BlueGreenGatewayOptions) {
  const upstreams: Record<DeploymentColor, URL> = {
    blue: normalizeUpstream(options.blueUpstream),
    green: normalizeUpstream(options.greenUpstream),
  };

  const server = http.createServer(async (req, res) => {
    try {
      const color = await readActiveColor(options.activeColorFile);
      const upstream = upstreams[color];
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && requestUrl.pathname === '/healthz') {
        const health = await probeUpstream(upstream, options.healthTimeoutMs || 3_000);
        return writeJson(res, health.ok ? 200 : 503, {
          ok: health.ok,
          role: 'blue-green-gateway',
          activeColor: color,
          upstreamStatus: health.status,
        });
      }

      proxyHttpRequest(req, res, upstream, color);
    } catch (error) {
      writeJson(res, 503, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      try {
        const color = await readActiveColor(options.activeColorFile);
        proxyUpgrade(req, socket, head, upstreams[color]);
      } catch {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      }
    })();
  });

  return server;
}

export async function readActiveColor(filePath: string): Promise<DeploymentColor> {
  const value = (await fs.readFile(filePath, 'utf8')).trim().toLowerCase();
  if (value === 'blue' || value === 'green') return value;
  throw new Error(`Invalid active deployment color: ${value || '(empty)'}`);
}

function proxyHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstream: URL,
  color: DeploymentColor,
) {
  const headers = forwardedHeaders(req);
  const proxyRequest = http.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || 80,
    method: req.method,
    path: req.url || '/',
    headers,
  }, (proxyResponse) => {
    const responseHeaders = { ...proxyResponse.headers };
    delete responseHeaders.connection;
    responseHeaders['x-altselfs-deployment-color'] = color;
    res.writeHead(proxyResponse.statusCode || 502, responseHeaders);
    proxyResponse.pipe(res);
  });

  proxyRequest.on('error', (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    writeJson(res, 502, { ok: false, error: `Active backend unavailable: ${error.message}` });
  });
  req.on('aborted', () => proxyRequest.destroy());
  req.pipe(proxyRequest);
}

function proxyUpgrade(
  req: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  upstream: URL,
) {
  const upstreamSocket = net.connect(Number(upstream.port || 80), upstream.hostname);
  upstreamSocket.on('connect', () => {
    const requestLine = `${req.method || 'GET'} ${req.url || '/'} HTTP/${req.httpVersion}\r\n`;
    const headers = Object.entries(forwardedHeaders(req))
      .flatMap(([name, value]) => Array.isArray(value)
        ? value.map((item) => `${name}: ${item}\r\n`)
        : value === undefined ? [] : [`${name}: ${value}\r\n`])
      .join('');
    upstreamSocket.write(`${requestLine}${headers}\r\n`);
    if (head.length > 0) upstreamSocket.write(head);
    clientSocket.pipe(upstreamSocket).pipe(clientSocket);
  });
  upstreamSocket.on('error', () => {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  });
}

function forwardedHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  const remoteAddress = req.socket.remoteAddress || '';
  const existingForwardedFor = typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for']
    : '';
  headers['x-forwarded-for'] = [existingForwardedFor, remoteAddress].filter(Boolean).join(', ');
  headers['x-forwarded-proto'] = (req.socket as typeof req.socket & { encrypted?: boolean }).encrypted
    ? 'https'
    : 'http';
  headers['x-forwarded-host'] = req.headers.host || '';
  delete headers['proxy-connection'];
  return headers;
}

async function probeUpstream(upstream: URL, timeoutMs: number) {
  return new Promise<{ ok: boolean; status: number | null }>((resolve) => {
    const request = http.get({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: '/healthz',
      timeout: timeoutMs,
    }, (response) => {
      response.resume();
      resolve({ ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300), status: response.statusCode || null });
    });
    request.on('timeout', () => request.destroy(new Error('health probe timed out')));
    request.on('error', () => resolve({ ok: false, status: null }));
  });
}

function normalizeUpstream(value: string) {
  const upstream = new URL(value);
  if (upstream.protocol !== 'http:') {
    throw new Error(`Blue-green gateway only supports internal HTTP upstreams: ${value}`);
  }
  return upstream;
}

function writeJson(res: http.ServerResponse, status: number, payload: Record<string, unknown>) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

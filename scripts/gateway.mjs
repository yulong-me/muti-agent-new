#!/usr/bin/env node
import http from 'http';
import net from 'net';

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '7000', 10);
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '7002', 10);
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '7001', 10);
const FRONTEND_HOST = process.env.FRONTEND_HOST || '127.0.0.1';
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';

function appendForwardedFor(existing, remoteAddress) {
  if (!remoteAddress) return existing;
  return existing ? `${existing}, ${remoteAddress}` : remoteAddress;
}

function normalizePath(url = '/') {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function resolveTarget(url = '/') {
  const path = normalizePath(url);

  if (
    path === '/health' ||
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/socket.io' ||
    path.startsWith('/socket.io/')
  ) {
    return { name: 'backend', host: BACKEND_HOST, port: BACKEND_PORT };
  }

  return { name: 'frontend', host: FRONTEND_HOST, port: FRONTEND_PORT };
}

function buildHeaders(req, target) {
  return {
    ...req.headers,
    host: `${target.host}:${target.port}`,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-port': String(GATEWAY_PORT),
    'x-forwarded-proto': 'http',
    'x-forwarded-for': appendForwardedFor(req.headers['x-forwarded-for'], req.socket.remoteAddress),
  };
}

function respondBadGateway(res, target, err) {
  res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Bad Gateway: ${target.name} upstream unavailable (${target.host}:${target.port})\n${err.message}`);
}

const server = http.createServer((req, res) => {
  const target = resolveTarget(req.url);
  const proxyReq = http.request(
    {
      hostname: target.host,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: buildHeaders(req, target),
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }

    respondBadGateway(res, target, err);
  });

  req.on('aborted', () => proxyReq.destroy());
  req.pipe(proxyReq);
});

server.on('upgrade', (req, socket, head) => {
  const target = resolveTarget(req.url);
  const upstream = net.connect(target.port, target.host);

  upstream.on('connect', () => {
    const headers = buildHeaders(req, target);
    const rawRequest =
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
      Object.entries(headers)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\r\n') +
      '\r\n\r\n';

    upstream.write(rawRequest);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on('error', () => {
    if (!socket.destroyed) {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });

  socket.on('error', () => upstream.destroy());
});

server.on('error', (err) => {
  console.error(`Gateway failed to start on port ${GATEWAY_PORT}: ${err.message}`);
  process.exit(1);
});

server.listen(GATEWAY_PORT, () => {
  console.log(
    `Gateway listening on http://localhost:${GATEWAY_PORT} -> frontend http://${FRONTEND_HOST}:${FRONTEND_PORT}, backend http://${BACKEND_HOST}:${BACKEND_PORT}`,
  );
});

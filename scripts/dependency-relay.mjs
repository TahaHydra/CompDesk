import http from 'node:http';
import https from 'node:https';

const host = process.env.DEPENDENCY_RELAY_HOST || '127.0.0.1';
const port = Number(process.env.DEPENDENCY_RELAY_PORT || 8899);
const RELAY_ORIGIN = 'http://dependency-relay.invalid';

function upstreamFor(rawUrl) {
  const incoming = new URL(rawUrl, RELAY_ORIGIN);
  if (incoming.origin !== RELAY_ORIGIN || incoming.username || incoming.password) {
    throw new Error('Only origin-relative dependency paths are accepted');
  }
  const prismaRequest = incoming.pathname.startsWith('/prisma/all_commits/');
  const upstream = new URL(prismaRequest ? 'https://binaries.prisma.sh' : 'https://registry.npmjs.org');
  upstream.pathname = prismaRequest ? incoming.pathname.slice('/prisma'.length) : incoming.pathname;
  upstream.search = incoming.search;
  return upstream;
}

const server = http.createServer((request, response) => {
  let upstream;
  try {
    upstream = upstreamFor(request.url || '/');
  } catch {
    response.writeHead(400, {'content-type':'text/plain; charset=utf-8'});
    response.end('Invalid dependency path');
    return;
  }
  process.stdout.write(`-> ${upstream.hostname}${upstream.pathname}\n`);
  // The upstream origin is selected from two constants after rejecting authority overrides.
  // codeql[js/request-forgery]
  const proxyRequest = https.request(upstream, {
    method: request.method,
    headers: {
      accept: request.headers.accept || '*/*',
      'user-agent': request.headers['user-agent'] || 'CompDesk dependency relay',
    },
  }, (proxyResponse) => {
    response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
    proxyResponse.pipe(response);
  });
  proxyRequest.on('error', (error) => {
    console.error(`Relay error: ${error.message}`);
    if (!response.headersSent) response.writeHead(502);
    response.end('Dependency relay failed');
  });
  request.pipe(proxyRequest);
});

server.listen(port, host, () => {
  console.log(`Dependency relay listening on http://${host}:${port}`);
  console.log('npm registry: http://127.0.0.1:8899/');
  console.log('Prisma mirror: http://127.0.0.1:8899/prisma');
  console.log('Press Ctrl+C to stop.');
});
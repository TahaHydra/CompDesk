import http from 'node:http';
import https from 'node:https';

const host = process.env.DEPENDENCY_RELAY_HOST || '127.0.0.1';
const port = Number(process.env.DEPENDENCY_RELAY_PORT || 8899);

function upstreamFor(rawUrl) {
  if (rawUrl.startsWith('/prisma/all_commits/')) {
    return new URL(rawUrl.slice('/prisma'.length), 'https://binaries.prisma.sh');
  }
  return new URL(rawUrl, 'https://registry.npmjs.org');
}

const server = http.createServer((request, response) => {
  const upstream = upstreamFor(request.url || '/');
  process.stdout.write(`-> ${upstream.hostname}${upstream.pathname}\n`);
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

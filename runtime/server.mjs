import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { env } from 'cloudflare:workers';
import { createCameraService } from './camera-service.mjs';
const requestScope = new AsyncLocalStorage();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const scope = requestScope.getStore();
  if (url.hostname === 'api.ecowitt.net' && scope) {
    scope.ecowittRequests++;
    if (scope.sqliteOnly) throw new Error('ECOWITT_FORBIDDEN_FOR_ARCHIVED_PERIOD');
  }
  return originalFetch(input, options);
};
const { default:worker } = await import('../dist/server/index.js');
const cameraService = createCameraService({ env, logger: (event) => console.log(JSON.stringify(event)) });
await cameraService.start();
const clientRoot = resolve('dist/client');
const mime = { '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2' };
const ASSETS = { async fetch(request) {
  let pathname;try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response('Bad request', { status:400 }); }
  const file = resolve(clientRoot, '.' + pathname);
  if (!file.startsWith(clientRoot + sep)) return new Response('Not found', { status:404 });
  try {
    if (!(await stat(file)).isFile()) return new Response('Not found', { status:404 });
    return new Response(request.method === 'HEAD' ? null : await readFile(file), { headers:{ 'Content-Type':mime[extname(file)] ?? 'application/octet-stream' } });
  } catch { return new Response('Not found', { status:404 }); }
} };
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name,item);
      else if (value !== undefined) headers.set(name,value);
    }
    const host = incoming.headers.host ?? 'clima2.antaisolar.com.br';
    if (!/^(clima2\.antaisolar\.com\.br|127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { outgoing.writeHead(400);outgoing.end('Invalid host');return; }
    const scheme = incoming.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const url = new URL(incoming.url, `${scheme}://${host}`);
    if (url.pathname === '/healthz') { outgoing.writeHead(200,{'Content-Type':'application/json'});outgoing.end('{"status":"ok"}');return; }
    if (url.pathname === '/api/weather/archive') { outgoing.writeHead(403);outgoing.end('Archive disabled on clima2');return; }
    const cameraResponse = cameraService.handle(url.pathname, new Request(url, { method:incoming.method, headers }));
    if (cameraResponse) {
      outgoing.statusCode=cameraResponse.status;
      for (const [name,value] of cameraResponse.headers) outgoing.setHeader(name,value);
      if (cameraResponse.body && incoming.method!=='HEAD') Readable.fromWeb(cameraResponse.body).pipe(outgoing);
      else outgoing.end();
      return;
    }
    let body;
    if (!['GET','HEAD'].includes(incoming.method)) {
      const parts=[];let bytes=0;
      for await (const part of incoming) { bytes+=part.length;if(bytes>1048576) {outgoing.writeHead(413);outgoing.end();return;}parts.push(part); }
      body=Buffer.concat(parts);
    }
    const request = new Request(url, { method:incoming.method, headers, body });
    const range = url.searchParams.get('range') ?? '24h';
    const date = url.searchParams.get('date');
    const today = new Date().toLocaleDateString('en-CA', { timeZone:'America/Sao_Paulo' });
    const scope = { ecowittRequests:0, sqliteOnly:url.pathname === '/api/weather' && url.searchParams.get('source') !== 'api' && (range !== '24h' || Boolean(date && date < today)) };
    const started = performance.now();
    const response = await requestScope.run(scope, () => worker.fetch(request, { ASSETS }, { waitUntil(promise) { promise.catch(error => console.error('Background task failed',error.name)); } }));
    if (url.pathname === '/api/weather') console.log(JSON.stringify({ range, date, source:url.searchParams.get("source"), view:url.searchParams.get("view"), durationMs:Math.round((performance.now()-started)*10)/10, status:response.status, sqliteOnly:scope.sqliteOnly, ecowittRequests:scope.ecowittRequests }));
    outgoing.statusCode=response.status;
    for (const [name,value] of response.headers) if (name.toLowerCase()!=='set-cookie') outgoing.setHeader(name,value);
    const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('Set-Cookie',cookies);
    if (response.body && incoming.method!=='HEAD') Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch(error) { console.error('Request failed',error.name,error.message);if(!outgoing.headersSent)outgoing.writeHead(500);outgoing.end('Server error'); }
});
server.requestTimeout=60000;
server.listen(Number(process.env.PORT ?? 8788),'127.0.0.1',()=>console.log('clima2 ready on loopback'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/data/egph.json', ['data/egph.json', 'application/json']],
]);
const server = createServer(async (request, response) => {
  const entry = files.get(new URL(request.url, 'http://localhost').pathname);
  if (!entry) { response.writeHead(404).end(); return; }
  try {
    const body = await readFile(new URL('../dist/' + entry[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' }).end(body);
  } catch { response.writeHead(500).end('Build the site before running browser tests.'); }
});
let child;
const stop = signal => child?.kill(signal);
const interrupt = () => stop('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseURL = process.env.BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const suites = process.argv.includes('--benchmark')
    ? ['benchmark-browser.mjs']
    : ['browser.mjs', 'traffic-browser.mjs', 'persistence-browser.mjs'];
  for (const suite of suites) {
    console.log(`\nRunning ${suite} at ${baseURL}`);
    await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['tests/' + suite], {
        cwd: root, env: { ...process.env, BASE_URL: baseURL }, stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        child = undefined;
        if (code === 0) resolve();
        else reject(new Error(`${suite} failed (${signal || code})`));
      });
    });
  }
} finally {
  stop('SIGTERM');
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}

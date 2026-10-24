// Exercises the hostname branching without wrangler, which pins every local request to the
// first custom domain. Stubs ASSETS so the routing logic is what is under test.
import worker from './worker.ts';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCRIPT = readFileSync(new URL('./public/bootstrap.sh', import.meta.url), 'utf8');
if (SCRIPT.includes('@QWIXBOX_INSTALL_REF@')) throw new Error('Unpinned bootstrap asset');
// Executing a download truncated before its final invocation must do no work.
const prefix = SCRIPT.slice(0, SCRIPT.lastIndexOf('main "$@"'));
const truncated = spawnSync('bash', { input: prefix, encoding: 'utf8' });
if (truncated.status !== 0 || truncated.stdout || truncated.stderr) throw new Error('Truncated bootstrap executed work');

const env = {
  ASSETS: {
    async fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === '/bootstrap.sh') return new Response(SCRIPT, { headers: { 'Content-Type': 'text/x-sh' } });
      if (p === '/' || p.endsWith('/')) return new Response('<html>site</html>', { headers: { 'Content-Type': 'text/html' } });
      return new Response('not found', { status: 404 });
    },
  },
};

let rc = 0;
const t = async (desc, req, check) => {
  const res = await worker.fetch(req, env);
  const body = await res.clone().text();
  const [okv, detail] = await check(res, body);
  console.log(`  ${okv ? 'PASS' : 'FAIL'}  ${desc.padEnd(52)} ${detail}`);
  if (!okv) rc = 1;
};

const R = (url, init) => new Request(url, init);

await t('get.* GET returns the script verbatim',
  R('https://get.qwixbox.com/'),
  async (r, b) => [r.status === 200 && b === SCRIPT, `${r.status} ${JSON.stringify(b.slice(0, 22))}`]);

await t('get.* serves it as text/plain, not a download',
  R('https://get.qwixbox.com/'),
  async (r) => [r.headers.get('content-type')?.startsWith('text/plain'), r.headers.get('content-type')]);

await t('get.* sets nosniff',
  R('https://get.qwixbox.com/'),
  async (r) => [r.headers.get('x-content-type-options') === 'nosniff', r.headers.get('x-content-type-options')]);

await t('get.* any path still returns the script',
  R('https://get.qwixbox.com/anything?x=1'),
  async (r, b) => [r.status === 200 && b === SCRIPT, `${r.status}`]);

await t('get.* POST is refused',
  R('https://get.qwixbox.com/', { method: 'POST' }),
  async (r) => [r.status === 405, `${r.status}`]);

await t('www.* redirects to the apex, preserving path',
  R('https://www.qwixbox.com/docs/mvp/'),
  async (r) => [r.status === 301 && r.headers.get('location') === 'https://qwixbox.com/docs/mvp/',
                `${r.status} ${r.headers.get('location')}`]);

await t('apex serves the site',
  R('https://qwixbox.com/'),
  async (r, b) => [r.status === 200 && b.includes('site'), `${r.status}`]);

await t('apex 404 stays a 404',
  R('https://qwixbox.com/nope'),
  async (r) => [r.status === 404, `${r.status}`]);

process.exit(rc);

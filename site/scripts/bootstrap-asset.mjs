import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../../bootstrap.sh', import.meta.url);
const output = new URL('../public/bootstrap.sh', import.meta.url);
if (process.argv.includes('--release-check')) {
  const runtimePaths = ['bootstrap.sh', 'install.sh', 'lib', 'steps', 'resources', 'portal'];
  const cwd = new URL('../..', import.meta.url);
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...runtimePaths], { cwd, encoding: 'utf8' });
  if (status.trim()) throw new Error('Commit the tested installer/runtime changes before publishing a pinned release');
  const ref = process.env.QWIXBOX_INSTALL_REF ?? 'HEAD';
  execFileSync('git', ['diff', '--quiet', ref, '--', ...runtimePaths], { cwd });
} else if (process.argv.includes('--check-dist')) {
  const built = readFileSync(new URL('../dist/bootstrap.sh', import.meta.url), 'utf8');
  if (built !== readFileSync(output, 'utf8')) throw new Error('Built bootstrap asset is missing or stale');
} else {
  const ref = process.env.QWIXBOX_INSTALL_REF ?? execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('QWIXBOX_INSTALL_REF must be a full commit SHA');
  mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
  writeFileSync(output, readFileSync(source, 'utf8').replaceAll('@QWIXBOX_INSTALL_REF@', ref));
}

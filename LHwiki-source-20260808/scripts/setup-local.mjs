import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const variablesPath = resolve(appDirectory, '.dev.vars');

if (!existsSync(variablesPath)) {
  writeFileSync(variablesPath, `SESSION_SECRET="${randomBytes(32).toString('hex')}"\n`, { mode: 0o600 });
  console.log('已生成仅用于本机的 .dev.vars。');
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const install = spawnSync(pnpm, ['install'], { cwd: appDirectory, stdio: 'inherit' });
if (install.error) throw install.error;
process.exitCode = install.status ?? 1;

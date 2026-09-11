import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REQUIRED_FILES = new Set(['server.js', 'api-app.cjs', 'package.json', 'scf_bootstrap']);
const FORBIDDEN_PATH = /(?:^|\/)(?:pg-store\.cjs|migration-data\.private\.json|deployment\.log|\.env(?:\.|$)|[^/]+\.(?:sql|pem|key))(?:$|\/)/i;
const FORBIDDEN_SEGMENT = /(?:^|\/)(?:archive|backup|migrations|node_modules)(?:$|\/)/i;

function normalizeManifestPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || isAbsolute(normalized)) {
    throw new Error(`Invalid production package path: ${value}`);
  }
  if (FORBIDDEN_PATH.test(normalized) || FORBIDDEN_SEGMENT.test(normalized)) {
    throw new Error(`Forbidden production package path: ${normalized}`);
  }
  return normalized;
}

function requireInsideProject(projectRoot, target, label) {
  const rel = relative(projectRoot, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must be a child of the project root`);
  }
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function buildProductionFunction({
  projectRoot = DEFAULT_PROJECT_ROOT,
  outputDir = resolve(projectRoot, 'release/cloudbase-functions/lhwiki-api'),
  reportPath = resolve(projectRoot, 'release/lhwiki-api-package-manifest.json')
} = {}) {
  projectRoot = resolve(projectRoot);
  outputDir = resolve(outputDir);
  reportPath = resolve(reportPath);
  requireInsideProject(projectRoot, outputDir, 'Output directory');
  requireInsideProject(projectRoot, reportPath, 'Manifest report');

  const sourceDir = resolve(projectRoot, 'cloudbase/functions/lhwiki-api');
  const manifestPath = resolve(projectRoot, 'cloudbase/function-production-files.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest?.functionName !== 'lhwiki-api' || !Array.isArray(manifest.files)) {
    throw new Error('Invalid CloudBase production function manifest');
  }

  const files = manifest.files.map(normalizeManifestPath);
  if (new Set(files).size !== files.length) throw new Error('Duplicate path in production function manifest');
  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) throw new Error(`Missing required production file: ${required}`);
  }

  try {
    const existing = await lstat(outputDir);
    if (existing.isSymbolicLink()) throw new Error('Refusing to replace a symlinked output directory');
    await rm(outputDir, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(outputDir, { recursive: true });

  const packaged = [];
  for (const relativePath of files) {
    const source = resolve(sourceDir, relativePath);
    const destination = resolve(outputDir, relativePath);
    requireInsideProject(sourceDir, source, 'Source file');
    requireInsideProject(outputDir, destination, 'Packaged file');
    const metadata = await lstat(source);
    if (!metadata.isFile()) throw new Error(`Production package entry is not a file: ${relativePath}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    packaged.push({ path: relativePath, sha256: await sha256(destination), bytes: metadata.size });
  }

  const report = {
    schemaVersion: 1,
    functionName: manifest.functionName,
    createdAt: new Date().toISOString(),
    outputDir,
    files: packaged
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const outputDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const report = await buildProductionFunction(outputDir ? { outputDir } : {});
  process.stdout.write(`${JSON.stringify({ ok: true, functionName: report.functionName, outputDir: report.outputDir, files: report.files.length })}\n`);
}

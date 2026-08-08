import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const output = resolve(projectRoot, 'cloudbase', 'functions', 'lhwiki-api', 'seed-data.json');
const sql = await readFile(resolve(projectRoot, 'schema.sql'), 'utf8');
const database = new DatabaseSync(':memory:');
database.exec(sql);

const sections = database.prepare('SELECT slug, title, description, icon, sort_order FROM sections ORDER BY sort_order').all();
const articles = database.prepare(`SELECT slug, section_slug, title, summary, body_json, content_type, subject,
  author_label, source_submission_id, published_at, updated_at FROM articles ORDER BY published_at DESC`).all();

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ version: 1, sections, articles }, null, 2)}\n`, 'utf8');
console.log(`已生成 ${output}（${sections.length} 个分区，${articles.length} 篇文章）`);

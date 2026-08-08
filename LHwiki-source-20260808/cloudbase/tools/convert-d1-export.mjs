import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) {
  console.error('用法：node convert-d1-export.mjs <wrangler-d1-export.sql>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const output = resolve(projectRoot, 'cloudbase', 'functions', 'lhwiki-api', 'migration-data.private.json');
const database = new DatabaseSync(':memory:');
database.exec(await readFile(resolve(source), 'utf8'));

const query = sql => database.prepare(sql).all();
const payload = {
  version: 1,
  exported_at: new Date().toISOString(),
  sections: query('SELECT slug, title, description, icon, sort_order FROM sections ORDER BY sort_order'),
  articles: query(`SELECT slug, section_slug, title, summary, body_json, content_type, subject, author_label,
    source_submission_id, published_at, updated_at FROM articles ORDER BY published_at DESC`),
  users: query('SELECT student_id, role, role_locked, created_at, last_login_at FROM users'),
  submissions: query(`SELECT id, student_id, section_slug, title, summary, body_json, content_type, subject,
    author_label, status, review_note, created_at, updated_at FROM submissions`),
  review_events: query('SELECT id, submission_id, reviewer_id, action, note, created_at FROM review_events')
};

await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`已生成私有迁移数据：${output}`);
console.log(`文章 ${payload.articles.length}，用户 ${payload.users.length}，投稿 ${payload.submissions.length}，审核记录 ${payload.review_events.length}`);

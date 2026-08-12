import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEACHERS } from '../public/teachers.js';

test('public teacher index has unique stable records', () => {
  assert.equal(TEACHERS.length, 209);
  assert.equal(new Set(TEACHERS.map(item => item.id)).size, TEACHERS.length);
  assert.equal(new Set(TEACHERS.map(item => item.name)).size, TEACHERS.length);
  const officialTeachers = TEACHERS.filter(item => item.sourceUrl);
  assert.equal(officialTeachers.length, 88);
  assert.equal(new Set(officialTeachers.map(item => item.sourceUrl)).size, officialTeachers.length);
  for (const teacher of TEACHERS) {
    assert.ok(teacher.name.length >= 2);
    assert.notEqual(teacher.subject, '学科待补充');
    if (teacher.sourceUrl) {
      assert.match(teacher.sourceUrl, /^https:\/\/www\.luhe\.cn\/article\/show\/\d+\.html$/);
      assert.ok(teacher.motto.length >= 4);
      assert.match(teacher.profile, /^官网公开资料显示：/);
      assert.match(teacher.publishedAt, /^2022-\d{2}-\d{2}$/);
    }
  }
});

test('teacher directory supplements import all unique spreadsheet rows without invented details', () => {
  const supplement = TEACHERS.filter(item => item.sourceLabel === '校内教师目录补充');
  assert.equal(supplement.length, 120);
  assert.equal(supplement.find(item => item.name === '邵红梅')?.subject, '语文');
  assert.equal(supplement.find(item => item.name === '郭淑慧')?.subject, '数学');
  assert.equal(supplement.find(item => item.name === '赵宝环')?.subject, '物理');
  assert.equal(supplement.find(item => item.name === '肖红蕊')?.subject, '心理');
  assert.equal(supplement.find(item => item.name === '李柯')?.subject, '语文');
  assert.equal(supplement.find(item => item.name === '李昳萌')?.subject, '数学');
  assert.equal(supplement.find(item => item.name === '江宇晨')?.subject, '美术');
  assert.equal(supplement.find(item => item.name === '张英杰')?.subject, '通用技术');
  for (const teacher of supplement) {
    assert.equal(teacher.motto, '');
    assert.equal(teacher.profile, '');
    assert.equal(teacher.sourceUrl, '');
    assert.match(teacher.id, /^directory-202608-\d{3}$/);
  }
});

test('teacher index includes records from the full official category', () => {
  const byName = new Map(TEACHERS.map(item => [item.name, item]));
  assert.equal(byName.get('祁京生')?.subject, '数学');
  assert.equal(byName.get('崔长华')?.subject, '信息技术');
  assert.equal(byName.get('任娟')?.subject, '化学');
  assert.equal(byName.get('李玉萍')?.subject, '语文');
  assert.equal(byName.get('王得勇')?.subject, '数学');
  assert.equal(TEACHERS.filter(item => item.name === '王得勇').length, 1);
  assert.equal(byName.get('张丁丁')?.subject, '英语');
});

test('community supplement keeps unknown teacher details empty', () => {
  const teacher = TEACHERS.find(item => item.name === '曲连红');
  assert.deepEqual(teacher, {
    id: 'community-qu-lianhong',
    name: '曲连红',
    subject: '化学',
    motto: '',
    profile: '',
    sourceUrl: '',
    sourceLabel: '校内成员补充',
    publishedAt: ''
  });
});

test('teacher index has no homeroom category and lists Li Yuping under Chinese', () => {
  const liYuping = TEACHERS.find(teacher => teacher.name === '李玉萍');
  assert.equal(liYuping?.subject, '语文');
  assert.equal(TEACHERS.some(teacher => teacher.subject === '班主任'), false);
});

test('teacher search updates results without replacing the focused input', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /function renderTeacherResults\(\)/);
  assert.match(source, /addEventListener\('input', event => \{ state\.teacherQuery = event\.target\.value; renderTeacherResults\(\); \}\)/);
  assert.doesNotMatch(source, /addEventListener\('input'[^\n]*teacherDirectory\(\)/);
});

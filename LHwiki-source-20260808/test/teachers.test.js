import test from 'node:test';
import assert from 'node:assert/strict';
import { TEACHERS } from '../public/teachers.js';

test('public teacher index has unique stable records', () => {
  assert.equal(TEACHERS.length, 89);
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

test('teacher index includes records from the full official category', () => {
  const byName = new Map(TEACHERS.map(item => [item.name, item]));
  assert.equal(byName.get('祁京生')?.subject, '数学');
  assert.equal(byName.get('崔长华')?.subject, '信息技术');
  assert.equal(byName.get('任娟')?.subject, '化学');
  assert.equal(byName.get('李玉萍')?.subject, '班主任');
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

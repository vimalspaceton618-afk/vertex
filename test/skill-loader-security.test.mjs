import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listWorkspaceSkills, readWorkspaceSkill } from '../dist/core/skills/SkillLoader.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-skills-'));
  const skills = path.join(root, '.vertex', 'skills');
  fs.mkdirSync(skills, { recursive: true, mode: 0o700 });
  return { root, skills };
}

function createSymlinkOrSkip(t, target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(error?.code)) {
      t.skip('Symlink creation is unavailable on this platform (' + error.code + ').');
      return false;
    }
    throw error;
  }
}
test('skill discovery is Markdown-only, sorted, and ignores invalid names and symlinks', (t) => {
  const { root, skills } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(skills, 'zeta.md'), '# Zeta\n');
  fs.writeFileSync(path.join(skills, 'alpha_2.md'), '# Alpha\n');
  fs.writeFileSync(path.join(skills, 'UPPER.md'), '# ignored\n');
  fs.writeFileSync(path.join(skills, 'run.js'), 'throw new Error("must never execute")');
  assert.deepEqual(listWorkspaceSkills(root).map((skill) => skill.name), ['alpha_2', 'zeta']);
});

test('skill reader rejects traversal and never follows symlinks', (t) => {
  const { root, skills } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(skills, 'safe.md'), '# Safe skill\n');
  fs.writeFileSync(path.join(root, 'outside.md'), '# Outside\n');
  if (!createSymlinkOrSkip(t, path.join(root, 'outside.md'), path.join(skills, 'linked.md'))) return;

  assert.equal(readWorkspaceSkill('safe', root), '# Safe skill\n');
  assert.throws(() => readWorkspaceSkill('../outside', root), /Invalid skill name/);
  assert.throws(() => readWorkspaceSkill('linked', root), /regular Markdown file/);
});

test('skill reader rejects oversized content and absent skill directories list as empty', (t) => {
  const { root, skills } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(skills, 'large.md'), 'x'.repeat(65 * 1024));

  assert.deepEqual(listWorkspaceSkills(path.join(root, 'missing')), []);
  assert.throws(() => readWorkspaceSkill('large', root), /exceeds the 65536-byte limit/);
});

test('skill discovery refuses a symlinked skills directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-skills-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'external.md'), '# external\\n');
  fs.mkdirSync(path.join(root, '.vertex'));
  if (!createSymlinkOrSkip(t, outside, path.join(root, '.vertex', 'skills'), 'dir')) return;

  assert.deepEqual(listWorkspaceSkills(root), []);
  assert.throws(() => readWorkspaceSkill('external', root), /real directory, not a symlink/);
});

test('skill discovery ignores symlinked Markdown entries when symlinks are available', (t) => {
  const { root, skills } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(skills, 'safe.md'), '# safe\\n');
  fs.writeFileSync(path.join(root, 'outside.md'), '# outside\\n');
  if (!createSymlinkOrSkip(t, path.join(root, 'outside.md'), path.join(skills, 'linked.md'))) return;
  assert.deepEqual(listWorkspaceSkills(root).map((skill) => skill.name), ['safe']);
});

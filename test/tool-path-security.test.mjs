import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodeSearchTool } from '../dist/tools/CodeSearch.js';
import { AnalyzeImageTool } from '../dist/tools/Vision.js';

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

test('code search rejects a target path that resolves outside the workspace', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-search-path-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-search-outside-'));
  const previousRoot = process.env.VERTEX_WORKSPACE_ROOT;
  try {
    process.env.VERTEX_WORKSPACE_ROOT = root;
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'workspace boundary marker');
    if (!createSymlinkOrSkip(t, outside, path.join(root, 'external'), 'dir')) return;
    const tool = new CodeSearchTool();
    await assert.rejects(() => tool.execute({ pattern: 'boundary marker', targetPath: path.join(root, 'external') }), /Path escapes workspace root/);
  } finally {
    if (previousRoot === undefined) delete process.env.VERTEX_WORKSPACE_ROOT;
    else process.env.VERTEX_WORKSPACE_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('image analysis refuses image paths outside the workspace before reading them', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-image-path-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-image-outside-'));
  const previousRoot = process.env.VERTEX_WORKSPACE_ROOT;
  try {
    process.env.VERTEX_WORKSPACE_ROOT = root;
    const imagePath = path.join(outside, 'private.png');
    fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71]));
    const result = await new AnalyzeImageTool().execute({ imagePath, prompt: 'Describe this image' });
    assert.match(result, /VISION ERROR/);
    assert.doesNotMatch(result, /data:image/);
  } finally {
    if (previousRoot === undefined) delete process.env.VERTEX_WORKSPACE_ROOT;
    else process.env.VERTEX_WORKSPACE_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('image analysis rejects unsupported extensions without calling a provider', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-image-ext-'));
  const previousRoot = process.env.VERTEX_WORKSPACE_ROOT;
  try {
    process.env.VERTEX_WORKSPACE_ROOT = root;
    const file = path.join(root, 'note.txt');
    fs.writeFileSync(file, 'not an image');
    const result = await new AnalyzeImageTool().execute({ imagePath: file, prompt: 'Describe this image' });
    assert.match(result, /Only JPG, PNG, WEBP, and GIF images are supported/);
  } finally {
    if (previousRoot === undefined) delete process.env.VERTEX_WORKSPACE_ROOT;
    else process.env.VERTEX_WORKSPACE_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

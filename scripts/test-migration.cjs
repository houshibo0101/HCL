// 共享资源目录迁移单测：node scripts/test-migration.cjs
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateInstance } = require('../electron/lib/shared-migration.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hcl-migrate-'));
const sharedAssets = path.join(root, 'shared', 'assets');
const sharedLibraries = path.join(root, 'shared', 'libraries');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function exists(file) { return fs.existsSync(file); }

const cases = [];
const check = (name, fn) => cases.push([name, fn]);

check('把实例内嵌的 assets / libraries 移动到共享目录', async () => {
  const gameDir = path.join(root, 'inst-a');
  write(path.join(gameDir, 'assets', 'objects', 'ab', 'abc123'), 'asset-payload');
  write(path.join(gameDir, 'assets', 'indexes', '17.json'), '{"objects":{}}');
  write(path.join(gameDir, 'libraries', 'net', 'fabric', 'fabric-loader.jar'), 'lib-payload');
  write(path.join(gameDir, 'mods', 'keep-me.jar'), 'should-stay');

  const migrated = await migrateInstance(gameDir, sharedAssets, sharedLibraries);
  assert.strictEqual(migrated, true, '应返回 true');
  assert.strictEqual(fs.readFileSync(path.join(sharedAssets, 'objects', 'ab', 'abc123'), 'utf8'), 'asset-payload');
  assert.strictEqual(fs.readFileSync(path.join(sharedAssets, 'indexes', '17.json'), 'utf8'), '{"objects":{}}');
  assert.strictEqual(fs.readFileSync(path.join(sharedLibraries, 'net', 'fabric', 'fabric-loader.jar'), 'utf8'), 'lib-payload');
  assert.strictEqual(exists(path.join(gameDir, 'assets')), false, '旧的 assets 目录应被删除');
  assert.strictEqual(exists(path.join(gameDir, 'libraries')), false, '旧的 libraries 目录应被删除');
  assert.strictEqual(fs.readFileSync(path.join(gameDir, 'mods', 'keep-me.jar'), 'utf8'), 'should-stay', 'mods 目录不受影响');
});

check('重复迁移是幂等的（第二次返回 false）', async () => {
  const migrated = await migrateInstance(path.join(root, 'inst-a'), sharedAssets, sharedLibraries);
  assert.strictEqual(migrated, false);
});

check('共享目录已有同名同大小文件时不重复占空间', async () => {
  const gameDir = path.join(root, 'inst-b');
  write(path.join(sharedAssets, 'indexes', '21.json'), 'same-content');
  write(path.join(gameDir, 'assets', 'indexes', '21.json'), 'same-content');

  await migrateInstance(gameDir, sharedAssets, sharedLibraries);
  assert.strictEqual(fs.readFileSync(path.join(sharedAssets, 'indexes', '21.json'), 'utf8'), 'same-content');
  assert.strictEqual(exists(path.join(gameDir, 'assets')), false, '旧目录仍要清理掉');
});

check('共享目录同名但大小不同时以实例里的为准', async () => {
  const gameDir = path.join(root, 'inst-c');
  write(path.join(sharedAssets, 'indexes', '22.json'), 'old');
  write(path.join(gameDir, 'assets', 'indexes', '22.json'), 'newer-content');

  await migrateInstance(gameDir, sharedAssets, sharedLibraries);
  assert.strictEqual(fs.readFileSync(path.join(sharedAssets, 'indexes', '22.json'), 'utf8'), 'newer-content');
});

check('没有 assets / libraries 实例直接跳过', async () => {
  const gameDir = path.join(root, 'inst-d');
  fs.mkdirSync(path.join(gameDir, 'versions'), { recursive: true });
  assert.strictEqual(await migrateInstance(gameDir, sharedAssets, sharedLibraries), false);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (error) { failed += 1; console.error(`  ✗ ${name}\n    ${error.message}`); }
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${cases.length - failed}/${cases.length} 组用例通过`);
  process.exit(failed ? 1 : 0);
})();

// 2.0.0：把旧实例目录里内嵌的 assets / libraries 迁移到全局共享目录
// 抽成独立模块便于单测：只做文件系统操作，不依赖 Electron
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// 递归合并 src 到 dest：同名同大小视为已有，直接丢弃旧副本；其余按 rename → copy 降级
async function mergeIntoShared(src, dest) {
  let entries;
  try { entries = await fsp.readdir(src, { withFileTypes: true }); } catch { return 0; }
  await fsp.mkdir(dest, { recursive: true });
  let moved = 0;
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) { moved += await mergeIntoShared(from, to); continue; }
    try {
      const target = await fsp.stat(to).catch(() => null);
      const source = await fsp.stat(from);
      if (target && target.size === source.size) { await fsp.rm(from, { force: true }); continue; }
      try {
        await fsp.rename(from, to);
      } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'EEXIST'].includes(error?.code)) throw error;
        await fsp.copyFile(from, to);
        await fsp.rm(from, { force: true });
      }
      moved += 1;
    } catch { /* 单个文件失败不阻断整体迁移，下次启动会继续 */ }
  }
  return moved;
}

// 迁移一个实例目录；返回是否真的做过迁移（用于提示用户一次）
async function migrateInstance(gameDir, sharedAssets, sharedLibraries) {
  const legacyAssets = path.join(gameDir, 'assets');
  const legacyLibraries = path.join(gameDir, 'libraries');
  const hasAssets = fs.existsSync(legacyAssets);
  const hasLibraries = fs.existsSync(legacyLibraries);
  if (!hasAssets && !hasLibraries) return false;
  await mergeIntoShared(legacyAssets, sharedAssets);
  await mergeIntoShared(legacyLibraries, sharedLibraries);
  await fsp.rm(legacyAssets, { recursive: true, force: true });
  await fsp.rm(legacyLibraries, { recursive: true, force: true });
  return true;
}

module.exports = { mergeIntoShared, migrateInstance };

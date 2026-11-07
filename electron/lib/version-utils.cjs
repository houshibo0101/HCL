// 版本号 / Java 版本相关的纯函数：从 main.cjs 抽出来，方便单测
// 这里只放不依赖 Electron、不读写文件、不联网的逻辑
const crypto = require('crypto');

// "1.8.0_402" → 8；"21.0.5" → 21；"17.0.14" → 17
function parseJavaMajor(version) {
  const m = String(version).match(/^(1\.)?(\d+)/);
  if (!m) return 0;
  return Number(m[2]);
}

// 按 Minecraft 版本号推断所需 Java 主版本（读不到版本 JSON 时的兜底）
function requiredJavaMajorFallback(versionId) {
  const m = String(versionId).match(/^1\.(\d+)(?:\.(\d+))?/);
  if (!m) return 8;
  const minor = Number(m[1]);
  const patch = Number(m[2] || 0);
  if (minor <= 16) return 8;                 // ≤ 1.16.5
  if (minor === 17) return 17;               // 1.17（官方 16，17 兼容）
  if (minor <= 20 && patch < 5) return 17;   // 1.18 – 1.20.4
  return 21;                                 // 1.20.5+ / 1.21+
}

// 实际去 Adoptium 下载哪个主版本（Adoptium 没有 16，用 17 兼容）
function pickDownloadMajor(required) {
  if (required <= 8) return 8;
  if (required <= 11) return 11;
  if (required <= 17) return 17;
  return 21;
}

// Forge / NeoForge 构建号倒序比较（放在前面的是更新的）
function compareBuildDesc(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff) return diff;
  }
  return String(b).localeCompare(String(a));
}

// 远端版本号是否比本地新（只比前三段，忽略 v 前缀与预发布后缀）
function isNewerVersion(remote, local) {
  const parse = (v) => String(v).replace(/^v/, '').split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const a = parse(remote);
  const b = parse(local);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// 1.12 及以前的语言代码是 zh_CN，之后是 zh_cn
function legacyLangCode(versionId) {
  const m = String(versionId).match(/1\.(\d+)/);
  return (m && Number(m[1]) <= 12) ? 'zh_CN' : 'zh_cn';
}

// 离线模式 UUID：OfflinePlayer:<name> 的 MD5（带连字符）
function offlineUuid(username) {
  const hex = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Mojang 清单里的 os.arch 只有 x86 / x64 / arm64 三种取值
function nativeArchName(arch) {
  return { x64: 'x64', ia32: 'x86', arm64: 'arm64' }[arch] || 'x86';
}

// 清单里 ${arch} 只有 32 / 64 两种；Apple Silicon 沿用 64（Rosetta 兼容）
function nativeClassifierSuffix(arch) {
  return arch === 'ia32' ? '32' : '64';
}

module.exports = {
  parseJavaMajor,
  requiredJavaMajorFallback,
  pickDownloadMajor,
  compareBuildDesc,
  isNewerVersion,
  legacyLangCode,
  offlineUuid,
  nativeArchName,
  nativeClassifierSuffix,
};

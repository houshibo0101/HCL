// 版本号 / Java 版本纯函数单测：node scripts/test-version-utils.cjs
const assert = require('assert');
const {
  parseJavaMajor, requiredJavaMajorFallback, pickDownloadMajor, javaDownloadCandidates, compareBuildDesc,
  isNewerVersion, legacyLangCode, offlineUuid, nativeArchName, nativeClassifierSuffix,
} = require('../electron/lib/version-utils.cjs');

const cases = [];
const check = (name, fn) => cases.push([name, fn]);
const eq = (actual, expected, label) => assert.deepStrictEqual(actual, expected, `${label}: 期望 ${expected}，实际 ${actual}`);

check('parseJavaMajor 解析常见 Java 版本串', () => {
  eq(parseJavaMajor('1.8.0_402'), 8, 'Java 8');
  eq(parseJavaMajor('17.0.14'), 17, 'Java 17');
  eq(parseJavaMajor('21.0.5+11-LTS'), 21, 'Java 21');
  eq(parseJavaMajor('1.7.0_80'), 7, 'Java 7');
  eq(parseJavaMajor('未知版本'), 0, '无法解析时返回 0');
});

check('requiredJavaMajorFallback 按 Minecraft 版本推断 Java', () => {
  eq(requiredJavaMajorFallback('1.12.2'), 8, '1.12.2 → 8');
  eq(requiredJavaMajorFallback('1.16.5'), 8, '1.16.5 → 8');
  eq(requiredJavaMajorFallback('1.17'), 17, '1.17 → 17');
  eq(requiredJavaMajorFallback('1.20.4'), 17, '1.20.4 → 17');
  eq(requiredJavaMajorFallback('1.20.5'), 21, '1.20.5 → 21');
  eq(requiredJavaMajorFallback('1.21.4'), 21, '1.21.4 → 21');
  eq(requiredJavaMajorFallback('24w14a'), 8, '快照号无法解析时退回 8');
});

check('pickDownloadMajor 不会去下载不存在的 Java 16', () => {
  eq(pickDownloadMajor(8), 8, '8');
  eq(pickDownloadMajor(11), 11, '11');
  eq(pickDownloadMajor(16), 17, '16 → 17');
  eq(pickDownloadMajor(17), 17, '17');
  eq(pickDownloadMajor(21), 21, '21');
});

check('pickDownloadMajor 对 Java 25 这类新版本按实际要求下载', () => {
  eq(pickDownloadMajor(25), 25, '25');
  eq(pickDownloadMajor(24), 24, '24');
  eq(pickDownloadMajor(30), 30, '30');
});

check('javaDownloadCandidates 先精确版本、再退到更新的 LTS', () => {
  eq(javaDownloadCandidates(25), [25], '25 没有更新的回退');
  eq(javaDownloadCandidates(24), [24, 25], '24 可以退到 25');
  eq(javaDownloadCandidates(22), [22, 25], '22 可以退到 25');
  eq(javaDownloadCandidates(21), [21, 25], '21 可以退到 25');
  eq(javaDownloadCandidates(17), [17], '17 不做升级回退');
  eq(javaDownloadCandidates(8), [8], '8 不做升级回退');
});

check('compareBuildDesc 新版本排在前面', () => {
  const builds = ['65.1.5', '65.1.10', '47.1.105'].sort(compareBuildDesc);
  eq(builds, ['65.1.10', '65.1.5', '47.1.105'], 'Forge 构建号倒序');
});

check('isNewerVersion 只比较前三段数字', () => {
  eq(isNewerVersion('v1.7.13', '1.7.12'), true, '补丁号更高');
  eq(isNewerVersion('1.7.12', '1.7.13'), false, '更旧');
  eq(isNewerVersion('1.7.13', '1.7.13'), false, '相同');
  eq(isNewerVersion('1.8.0', '1.7.99'), true, '次版本号更高');
  eq(isNewerVersion('2.0.0', '1.99.99'), true, '主版本号更高');
});

check('legacyLangCode 兼容 1.12 之前的老语言代码', () => {
  eq(legacyLangCode('1.12.2'), 'zh_CN', '1.12.2');
  eq(legacyLangCode('1.13'), 'zh_cn', '1.13');
  eq(legacyLangCode('1.21.4'), 'zh_cn', '1.21.4');
});

check('offlineUuid 与 Mojang 离线 UUID 算法一致', () => {
  eq(offlineUuid('Notch'), 'b50ad385-829d-a141-a216-7e7d7539ba7f', '已知向量 Notch');
  eq(offlineUuid('Player'), 'a01e3843-e521-5998-558a-f459800e4d11', '已知向量 Player');
  assert.match(offlineUuid('任意名字'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'UUID 格式');
  assert.notStrictEqual(offlineUuid('Notch'), offlineUuid('Herobrine'), '不同名字得到不同 UUID');
});

check('arch 映射覆盖 Apple Silicon', () => {
  eq(nativeArchName('x64'), 'x64', 'x64');
  eq(nativeArchName('ia32'), 'x86', 'ia32');
  eq(nativeArchName('arm64'), 'arm64', 'arm64');
  eq(nativeArchName('mips'), 'x86', '未知架构兜底');
  eq(nativeClassifierSuffix('x64'), '64', 'x64 natives');
  eq(nativeClassifierSuffix('arm64'), '64', 'arm64 沿用 64');
  eq(nativeClassifierSuffix('ia32'), '32', 'ia32 natives');
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} 组用例通过`);
process.exit(failed ? 1 : 0);

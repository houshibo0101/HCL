// 测试新加载器模块：从 main.cjs 机械截取相关函数段并 eval 注桩执行
// 用法：node scripts/test-loader-modules.cjs
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

function extractSection(name, nextMarker) {
  // 优先匹配 async function（否则 indexOf 会命中 async 声明的后半段丢掉 async 前缀）
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到函数 ${name}`);
  const end = source.indexOf(nextMarker, start);
  if (end < 0) throw new Error(`找不到 ${name} 的结束标记 ${nextMarker}`);
  return source.slice(start, end);
}

const pieces = [
  extractSection('compareBuildDesc', 'async function getForgeBuilds'),
  extractSection('getForgeBuilds', 'async function getNeoForgeBuilds'),
  extractSection('getNeoForgeBuilds', 'async function getQuiltLoaders'),
  extractSection('getQuiltLoaders', 'async function detectProxyJvmArgs'),
  source.match(/function neoforgeInstallerPath[\s\S]*?\n}/)?.[0] || '',
].join('\n');

// 桩：fetchJson
const stubs = `
const fetchJsonLog = [];
async function fetchJson(url) {
  fetchJsonLog.push(url);
  if (url.includes('bmclapi2.bangbang93.com/neoforge/list/')) {
    if (url.includes('1.21.1')) return [
      { version: '21.1.57', rawVersion: 'neoforge-21.1.57', installerPath: '/maven/net/neoforged/neoforge/21.1.57/neoforge-21.1.57-installer.jar' },
      { version: '21.1.60', rawVersion: 'neoforge-21.1.60', installerPath: '/maven/net/neoforged/neoforge/21.1.60/neoforge-21.1.60-installer.jar' },
      { version: '21.1.80', rawVersion: 'neoforge-21.1.80', installerPath: '/maven/net/neoforged/neoforge/21.1.80/neoforge-21.1.80-installer.jar' },
    ];
    if (url.includes('1.20.1')) return [
      { version: '1.20.1-47.1.103', rawVersion: '1.20.1-forge-47.1.103', installerPath: '/maven/net/neoforged/forge/1.20.1-47.1.103/forge-1.20.1-47.1.103-installer.jar' },
      { version: '1.20.1-47.1.105', rawVersion: '1.20.1-forge-47.1.105', installerPath: '/maven/net/neoforged/forge/1.20.1-47.1.105/forge-1.20.1-47.1.105-installer.jar' },
    ];
    throw new Error('404');
  }
  if (url.includes('meta.quiltmc.org')) {
    return [{ loader: { version: '0.29.0' } }, { loader: { version: '0.28.1' } }];
  }
  throw new Error('unexpected url: ' + url);
}
`;

(async () => {
  // 注桩执行：把桩与函数体包进一个 async 工厂函数返回模块接口
  const factoryCode = `(async function () {\n${stubs}\n${pieces}\nreturn { getNeoForgeBuilds, getQuiltLoaders, neoforgeInstallerPath };\n})`;
  // eslint-disable-next-line no-eval
  const makeModule = eval(factoryCode);
  const m = await makeModule();
  // NeoForge 1.21.1（新格式）
  const nf21 = await m.getNeoForgeBuilds('1.21.1');
  console.log('NeoForge 1.21.1:', JSON.stringify(nf21));
  if (nf21.builds.length !== 3) throw new Error('NeoForge 1.21.1 构建数应为 3');
  if (nf21.builds[0].id !== '21.1.80') throw new Error('排序错误：最新应在前');
  // NeoForge 1.20.1（旧格式）
  const nf20 = await m.getNeoForgeBuilds('1.20.1');
  console.log('NeoForge 1.20.1:', JSON.stringify(nf20));
  if (nf20.builds.length !== 2) throw new Error('NeoForge 1.20.1 构建数应为 2');
  // Quilt
  const quilt = await m.getQuiltLoaders('1.20.1');
  console.log('Quilt 1.20.1:', JSON.stringify(quilt));
  if (quilt.loaders[0] !== '0.29.0') throw new Error('Quilt 最新版应为 0.29.0');
  // installer 路径映射
  const p1 = m.neoforgeInstallerPath('21.1.57');
  const p2 = m.neoforgeInstallerPath('1.20.1-47.1.105');
  console.log('path new:', p1);
  console.log('path old:', p2);
  if (p1 !== '/maven/net/neoforged/neoforge/21.1.57/neoforge-21.1.57-installer.jar') throw new Error('新格式路径映射错误');
  if (p2 !== '/maven/net/neoforged/forge/1.20.1-47.1.105/forge-1.20.1-47.1.105-installer.jar') throw new Error('旧格式路径映射错误');
  console.log('\n✓ 全部通过：getNeoForgeBuilds / getQuiltLoaders / neoforgeInstallerPath');
})().catch((e) => { console.error('✗ 失败:', e.message); process.exit(1); });

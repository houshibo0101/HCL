// 从 electron/main.cjs 机械抽取 listJavas/detectJava/Java 模块，注入桩依赖后真实执行
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('D:/HCL/node_modules/adm-zip');
const { execFile, spawn } = require('child_process');

const src = fs.readFileSync('D:/HCL/electron/main.cjs', 'utf8');
const cut = (startMark, endMark) => {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error('section not found: ' + startMark);
  return src.slice(a, b);
};
const fsp = fs.promises;
const DATA_ROOT = path.join(os.tmpdir(), 'hcl-javatest-data');
const settings = { javaPath: '' };
const code = `
const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const AdmZip = require('D:/HCL/node_modules/adm-zip');
const DATA_ROOT = ${JSON.stringify(DATA_ROOT)};
const settings = { javaPath: '' };
const createTask = () => 't1';
const updateTask = () => {};
const finishTask = () => {};
const fetchJson = async (url) => (await fetch(url)).json();
const downloadFile = async () => {};
const USER_AGENT = 'x';
`;
const listJavasCode = cut('async function listJavas', '// ---------- Java 自动匹配与下载 ----------');
const javaModuleCode = cut('// ---------- Java 自动匹配与下载 ----------', 'function offlineUuid');
const full = code + listJavasCode + javaModuleCode + `
(async () => {
  const list = await listJavas();
  console.log('listJavas OK, found', list.length, 'javas:');
  list.slice(0, 5).forEach((j) => console.log('  -', j.version, 'major=' + j.major, '@', j.path));
  console.log('detectJava:', JSON.stringify(await detectJava()).slice(0, 120));
  console.log('fallback 1.12.2 =>', requiredJavaMajorFallback('1.12.2'));
  console.log('fallback 1.17.1 =>', requiredJavaMajorFallback('1.17.1'));
  console.log('fallback 1.20.4 =>', requiredJavaMajorFallback('1.20.4'));
  console.log('fallback 1.20.6 =>', requiredJavaMajorFallback('1.20.6'));
  console.log('fallback 1.21.1 =>', requiredJavaMajorFallback('1.21.1'));
  console.log('pickDownloadMajor(8/16/17/21/22) =>', pickDownloadMajor(8), pickDownloadMajor(16), pickDownloadMajor(17), pickDownloadMajor(21), pickDownloadMajor(22));
  console.log('parseJavaMajor("1.8.0_402"/"21.0.5") =>', parseJavaMajor('1.8.0_402'), parseJavaMajor('21.0.5'));
  const inst = { version: '1.20.4', runtimeVersion: '1.20.4', versionDir: ${JSON.stringify(path.join(DATA_ROOT, 'games', 'nonexistent'))} };
  console.log('requiredJavaMajor(nonexistent dir) =>', await requiredJavaMajor(inst));
  const resolved = await resolveJavaForInstance({ version: '1.20.4', runtimeVersion: '1.20.4', versionDir: ${JSON.stringify(path.join(DATA_ROOT, 'games', 'nonexistent'))} });
  console.log('resolveJavaForInstance(1.20.4) =>', 'major=' + resolved.java.major, 'downloaded=' + resolved.downloaded, 'required=' + resolved.required);
  const resolved2 = await resolveJavaForInstance({ version: '1.21.1', runtimeVersion: '1.21.1', versionDir: ${JSON.stringify(path.join(DATA_ROOT, 'games', 'nonexistent'))} });
  console.log('resolveJavaForInstance(1.21.1) =>', 'major=' + resolved2.java.major, 'downloaded=' + resolved2.downloaded, 'required=' + resolved2.required);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
`;
fs.mkdirSync(DATA_ROOT, { recursive: true });
eval(full);

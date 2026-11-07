// 开发用：批量截取各页面，便于 UI 改动前后对比
// 用法: node scripts/capture-pages.cjs [输出目录] [页面...]
//   页面取值为导航文案：首页 / 游戏版本 / Mod 下载 / 光影下载 / 联机 / 下载管理 / 设置
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const outDir = process.argv[2] || path.join(process.env.TEMP || '.', 'hcl-captures');
const pages = process.argv.slice(3);
const targets = pages.length ? pages : ['首页'];
const electron = require('electron');

fs.mkdirSync(outDir, { recursive: true });

function capture(page, file) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, HCL_CAPTURE_PATH: file, HCL_CAPTURE_PAGE: page };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, ['.'], { cwd: ROOT, env, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${page} 超时`)); }, 60000);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

(async () => {
  for (const page of targets) {
    const file = path.join(outDir, `${page.replace(/\s+/g, '-')}.png`);
    await capture(page, file);
    const exists = fs.existsSync(file);
    console.log(`${exists ? '✓' : '✗'} ${page} -> ${file}`);
  }
})().catch((error) => { console.error(error.message); process.exit(1); });

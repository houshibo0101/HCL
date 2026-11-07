// 通过 GitHub Git Data API 推送当前 HEAD（本地代理对 github.com 主站 502 时的备用通道）
// 用法: node scripts/push-via-api.cjs <token> <file1> <file2> ...
const fs = require('fs');
const path = require('path');

const REPO = 'houshibo0101/HCL';
const BRANCH = 'main';
const API = 'https://api.github.com';

async function main() {
  const [token, ...rest] = process.argv.slice(2);
  const skipTreeCheck = rest[0] === '--skip-tree-check';
  const files = skipTreeCheck ? rest.slice(1) : rest;
  if (!token || !files.length) throw new Error('usage: node push-via-api.cjs <token> [--skip-tree-check] <files...>');
  const headers = { Authorization: `token ${token}`, 'User-Agent': 'HCL-Release', 'Content-Type': 'application/json' };
  const req = async (url, options = {}) => {
    const res = await fetch(`${API}${url}`, { headers, ...options });
    if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} -> ${res.status}: ${await res.text()}`);
    return res.json();
  };

  // 1. 远程 main 当前指向
  const ref = await req(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const remoteSha = ref.object.sha;
  console.log('remote main:', remoteSha);

  // 2. 校验远程提交内容树与本地 HEAD^ 一致（API 推送的历史 hash 与本地不同但内容等价）
  const { execSync } = require('child_process');
  const localHead = execSync('git rev-parse HEAD').toString().trim();
  const localBaseTree = execSync('git rev-parse "HEAD^{tree}"').toString().trim();
  const remoteCommit = await req(`/repos/${REPO}/git/commits/${remoteSha}`);
  const headFiles = execSync('git diff --name-only HEAD^ HEAD').toString().trim().split('\n').filter(Boolean).sort();
  const pushFiles = files.map((f) => f.replace(/\\/g, '/')).sort();
  if (JSON.stringify(headFiles) !== JSON.stringify(pushFiles)) {
    // 本地 HEAD 相对 HEAD^ 的改动文件必须与本次推送文件一致，才能保证内容等价
    console.log('warn: HEAD diff files =', headFiles.join(','), '; pushing =', pushFiles.join(','));
  }
  const localParentTree = execSync('git rev-parse "HEAD^^{tree}"').toString().trim();
  if (!skipTreeCheck && remoteCommit.tree.sha !== localParentTree) {
    throw new Error(`远程 tree ${remoteCommit.tree.sha} 与本地 HEAD^ tree ${localParentTree} 不一致，先对齐远程历史`);
  }
  void localBaseTree;
  const message = execSync('git log -1 --pretty=%B').toString().trim();

  // 3. blobs（本地已删除的文件用 sha: null 表示删除）
  const tree = [];
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    const absolute = path.resolve(file);
    if (!fs.existsSync(absolute)) {
      tree.push({ path: normalized, mode: '100644', type: 'blob', sha: null });
      console.log('delete:', normalized);
      continue;
    }
    const content = fs.readFileSync(absolute);
    const blob = await req(`/repos/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }) });
    tree.push({ path: normalized, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('blob:', normalized, blob.sha.slice(0, 7));
  }

  // 4. tree -> commit -> ref
  const newTree = await req(`/repos/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: remoteSha, tree }) });
  const newCommit = await req(`/repos/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [remoteSha] }) });
  await req(`/repos/${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha }) });
  console.log('pushed:', newCommit.sha, '(local head was', localHead.slice(0, 7) + ')');
}

main().catch((e) => { console.error(e.message); process.exit(1); });

// 下载器单测：本地起 HTTP 服务，覆盖正常下载 / 断点续传 / Range 异常 / 哈希失败重试
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { downloadFile, downloadSingle } = require('../electron/lib/downloader.cjs');

const PAYLOAD = Buffer.from(Array.from({ length: 200000 }, (_, i) => (i * 37) % 251));
const SHA1 = crypto.createHash('sha1').update(PAYLOAD).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hcl-dl-'));
const file = (name) => path.join(root, name);
const digest = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');

let hits = 0;
let badRangeHits = 0;

const server = http.createServer((req, res) => {
  hits += 1;
  if (req.url === '/wrong-bytes') {
    const other = Buffer.alloc(PAYLOAD.length, 7);
    res.writeHead(200, { 'Content-Length': other.length });
    res.end(other);
    return;
  }
  if (req.url === '/ignore-range') {
    // 声称支持 Range 却总返回完整内容，一些代理会这样
    res.writeHead(200, { 'Content-Length': PAYLOAD.length });
    res.end(PAYLOAD);
    return;
  }
  if (req.url === '/bad-range') {
    // 返回 206，但起点永远从 0 开始
    badRangeHits += 1;
    res.writeHead(206, { 'Content-Range': `bytes 0-${PAYLOAD.length - 1}/${PAYLOAD.length}`, 'Content-Length': PAYLOAD.length });
    res.end(PAYLOAD);
    return;
  }
  const range = req.headers.range;
  if (range) {
    const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
    const chunk = PAYLOAD.subarray(start);
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`, 'Content-Length': chunk.length });
    res.end(chunk);
    return;
  }
  res.writeHead(200, { 'Content-Length': PAYLOAD.length, 'Accept-Ranges': 'bytes' });
  res.end(PAYLOAD);
});

const base = () => `http://127.0.0.1:${server.address().port}`;
const cases = [];
const check = (name, fn) => cases.push([name, fn]);

check('正常下载并通过 SHA1 校验', async () => {
  const dest = file('ok.bin');
  const result = await downloadSingle(`${base()}/ok`, dest, { sha1: SHA1, expectedSize: PAYLOAD.length });
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(fs.statSync(dest).size, PAYLOAD.length);
  assert.strictEqual(digest(dest), SHA1);
});

check('已存在的正确文件直接复用（不再发请求）', async () => {
  const dest = file('ok.bin');
  const before = hits;
  const result = await downloadSingle(`${base()}/ok`, dest, { sha1: SHA1, expectedSize: PAYLOAD.length });
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(hits, before);
});

check('断点续传：已有半截 .part 时只请求一次并拼出正确文件', async () => {
  const dest = file('resume.bin');
  fs.writeFileSync(`${dest}.part`, PAYLOAD.subarray(0, 80000));
  const before = hits;
  await downloadSingle(`${base()}/ok`, dest, { sha1: SHA1, expectedSize: PAYLOAD.length });
  assert.strictEqual(hits - before, 1);
  assert.strictEqual(digest(dest), SHA1);
});

check('服务端忽略 Range（返回 200）时重新完整下载', async () => {
  const dest = file('ignore.bin');
  fs.writeFileSync(`${dest}.part`, Buffer.alloc(50000, 1));
  await downloadSingle(`${base()}/ignore-range`, dest, { sha1: SHA1, expectedSize: PAYLOAD.length });
  assert.strictEqual(digest(dest), SHA1);
});

check('服务端 206 起点不对时丢弃断点重下', async () => {
  const dest = file('badrange.bin');
  fs.writeFileSync(`${dest}.part`, Buffer.alloc(60000, 2));
  await downloadSingle(`${base()}/bad-range`, dest, { sha1: SHA1, expectedSize: PAYLOAD.length });
  assert.strictEqual(digest(dest), SHA1);
  assert.ok(badRangeHits >= 1);
});

check('内容与哈希不符时重试一次后报 HASH_MISMATCH', async () => {
  const dest = file('wrong.bin');
  const before = hits;
  await assert.rejects(
    () => downloadSingle(`${base()}/wrong-bytes`, dest, { sha1: SHA1, expectedSize: PAYLOAD.length }),
    (error) => error.code === 'HASH_MISMATCH',
  );
  assert.strictEqual(hits - before, 2, '应该正好请求两次（首次 + 重试）');
  assert.strictEqual(fs.existsSync(dest), false);
  assert.strictEqual(fs.existsSync(`${dest}.part`), false);
});

check('大小对但内容错的文件不会被误判为已完成', async () => {
  const dest = file('fakeok.bin');
  fs.writeFileSync(dest, Buffer.alloc(PAYLOAD.length, 9));
  await downloadSingle(`${base()}/ok`, dest, { sha1: SHA1, expectedSize: PAYLOAD.length });
  assert.strictEqual(digest(dest), SHA1);
});

check('多 URL 回退：第一个源坏了就用第二个', async () => {
  const dest = file('fallback.bin');
  await downloadFile([`${base()}/wrong-bytes`, `${base()}/ok`], dest, { sha1: SHA1, expectedSize: PAYLOAD.length });
  assert.strictEqual(digest(dest), SHA1);
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${name}\n    ${error.message}`);
    }
  }
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${cases.length - failed}/${cases.length} 组用例通过`);
  process.exit(failed ? 1 : 0);
})();

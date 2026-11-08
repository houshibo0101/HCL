// 下载器：断点续传 + SHA1 校验 + 失败重试
// 抽成独立模块，便于用本地 HTTP 服务做单测
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const DEFAULT_UA = 'HCL/2 (Minecraft Launcher)';
const inFlight = new Map();

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function fileSize(file) {
  try {
    const stat = await fsp.stat(file);
    return stat.isFile() ? stat.size : -1;
  } catch {
    return -1;
  }
}

async function fileExists(file, expectedSize) {
  const size = await fileSize(file);
  if (size < 0) return false;
  return !expectedSize || size === expectedSize;
}

async function moveIntoPlace(partial, destination) {
  try {
    await fsp.rename(partial, destination);
  } catch (error) {
    // Windows 上目标已存在时 rename 会失败，覆盖一次再试
    if (['EPERM', 'EACCES', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
      await fsp.rm(destination, { force: true });
      await fsp.rename(partial, destination);
      return;
    }
    throw error;
  }
}

function parseContentRange(value) {
  const match = String(value || '').match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? null : Number(match[3]) };
}

// 同一目标并发下载合并成一次，避免多任务同时写同一个 .part
async function downloadSingle(url, destination, options = {}) {
  const running = inFlight.get(destination);
  if (running) return running;
  const promise = downloadSingleInner(url, destination, options, 0).finally(() => inFlight.delete(destination));
  inFlight.set(destination, promise);
  return promise;
}

async function downloadSingleInner(url, destination, options, attempt) {
  const { signal, onProgress, expectedSize = 0, sha1 = '', userAgent = DEFAULT_UA } = options;
  const expectedHash = String(sha1 || '').toLowerCase();

  // 1. 成品已存在：大小 + 哈希都对得上就直接复用
  if (await fileExists(destination, expectedSize)) {
    if (!expectedHash || (await sha1File(destination)) === expectedHash) {
      const size = await fileSize(destination);
      onProgress?.(size, size);
      return { path: destination, size, skipped: true };
    }
    await fsp.rm(destination, { force: true }).catch(() => {});
  }
  if (signal?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  let offset = (await fileSize(partial)) || 0;

  // 2. 带 Range 请求续传
  const headers = { 'User-Agent': userAgent };
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const response = await fetch(url, { signal, headers });

  if (response.status === 416 && offset > 0) {
    // 服务端认为区间越界（多半是上次刚好下完）：丢掉重来
    await fsp.rm(partial, { force: true });
    return downloadSingleInner(url, destination, options, attempt);
  }
  if (!response.ok) {
    await fsp.rm(partial, { force: true }).catch(() => {});
    throw new Error(`下载失败 (${response.status})：${path.basename(destination)}`);
  }
  if (!response.body) throw new Error('下载响应为空');

  let resumed = false;
  if (response.status === 206 && offset > 0) {
    // 必须确认服务端返回的起点就是我们的断点，否则拼出来的文件是错的
    const range = parseContentRange(response.headers.get('content-range'));
    if (range && range.start === offset) {
      resumed = true;
    } else {
      await fsp.rm(partial, { force: true });
      offset = 0;
    }
  } else if (response.status === 200) {
    // 服务端忽略了 Range，整段重下
    offset = 0;
  }

  const contentLength = Number(response.headers.get('content-length')) || 0;
  const total = (resumed ? offset : 0) + contentLength || expectedSize || 0;
  let received = resumed ? offset : 0;
  let lastNotice = 0;

  // 3. 计数放在管线内部，保证"写进去多少"和"统计到多少"永远一致
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      const now = Date.now();
      if (now - lastNotice > 90) {
        onProgress?.(received, total);
        lastNotice = now;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      counter,
      fs.createWriteStream(partial, { flags: resumed ? 'a' : 'w' }),
    );
  } catch (error) {
    // 中断保留 .part 供下次续传；主动取消则交给上层处理
    throw error;
  }

  const written = await fileSize(partial);
  if (expectedSize && written !== expectedSize) {
    await fsp.rm(partial, { force: true }).catch(() => {});
    if (attempt < 1) return downloadSingleInner(url, destination, options, attempt + 1);
    throw Object.assign(new Error(`文件大小不符（${written}/${expectedSize} 字节）：${path.basename(destination)}`), { code: 'SIZE_MISMATCH' });
  }
  if (expectedHash) {
    const actual = await sha1File(partial);
    if (actual !== expectedHash) {
      await fsp.rm(partial, { force: true }).catch(() => {});
      if (attempt < 1) return downloadSingleInner(url, destination, options, attempt + 1);
      throw Object.assign(
        new Error(`文件校验失败（SHA1 不匹配）：${path.basename(destination)}（实得 ${actual}，期望 ${expectedHash}，${written} 字节）`),
        { code: 'HASH_MISMATCH', actual, expected: expectedHash },
      );
    }
  }
  await moveIntoPlace(partial, destination);
  onProgress?.(written, written);
  return { path: destination, size: written, skipped: false };
}

// 支持 url 或 urls（数组依次尝试）：官方源失败自动切换镜像
async function downloadFile(urlOrUrls, destination, options = {}) {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  let lastError;
  for (const url of urls) {
    try {
      return await downloadSingle(url, destination, options);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError;
}

module.exports = { downloadFile, downloadSingle, sha1File, fileExists, fileSize, moveIntoPlace };

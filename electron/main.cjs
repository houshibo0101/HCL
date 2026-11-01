const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
const DATA_ROOT = process.env.HCL_DATA_DIR || (process.platform === 'win32' && fs.existsSync('D:\\') ? 'D:\\HCL\\data' : path.join(app.getPath('userData'), 'data'));
const SETTINGS_FILE = path.join(DATA_ROOT, 'settings.json');
const INSTANCES_FILE = path.join(DATA_ROOT, 'instances.json');
const ACCOUNTS_FILE = path.join(DATA_ROOT, 'accounts.json');
const CACHE_DIR = path.join(DATA_ROOT, 'cache');
let accounts = [];
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const USER_AGENT = 'HCL/1.0 (Minecraft Launcher)';
let mainWindow;
let settings;
let instances = [];
const tasks = new Map();
const controllers = new Map();
const gameProcesses = new Map();

const defaultSettings = () => ({
  username: 'Player',
  memory: 4096,
  javaPath: '',
  gameDirectory: path.join(DATA_ROOT, 'games'),
  selectedInstanceId: null,
  closeOnLaunch: false,
  theme: 'green',
  autoChineseLang: true,
  autoUpdate: true,
  autoDownloadJava: true,
  memoryOptimize: true,
});

const THEME_BACKGROUNDS = {
  green: '#0d120f', blue: '#0d1114', purple: '#0f0d13',
  orange: '#120f0c', pink: '#120d0f', teal: '#0c1110',
};

async function ensureStorage() {
  await fsp.mkdir(DATA_ROOT, { recursive: true });
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  try {
    settings = { ...defaultSettings(), ...JSON.parse(await fsp.readFile(SETTINGS_FILE, 'utf8')) };
  } catch {
    settings = defaultSettings();
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  }
  try {
    instances = JSON.parse(await fsp.readFile(INSTANCES_FILE, 'utf8'));
  } catch {
    instances = [];
    await fsp.writeFile(INSTANCES_FILE, '[]');
  }
  try {
    accounts = JSON.parse(await fsp.readFile(ACCOUNTS_FILE, 'utf8'));
  } catch {
    accounts = [];
  }
  if (!accounts.length && (settings.username || '').trim()) {
    // 迁移：把旧的离线玩家名变成第一个离线账户
    const name = settings.username.trim() || 'Player';
    accounts = [{ id: `offline-${Date.now().toString(36)}`, type: 'offline', name, uuid: offlineUuid(name), accessToken: '0', apiRoot: '', createdAt: Date.now() }];
    settings.currentAccountId = accounts[0].id;
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  }
  await fsp.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  await fsp.mkdir(settings.gameDirectory, { recursive: true });
}

function saveAccounts() {
  return fsp.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function publicTask(task) {
  return { ...task };
}

function updateTask(id, patch) {
  const previous = tasks.get(id);
  if (!previous) return;
  const next = { ...previous, ...patch, updatedAt: Date.now() };
  tasks.set(id, next);
  send('tasks:update', publicTask(next));
}

function createTask(kind, title, total = 0) {
  const id = crypto.randomUUID();
  const task = { id, kind, title, status: 'downloading', progress: 0, received: 0, total, detail: '准备下载…', createdAt: Date.now(), updatedAt: Date.now() };
  tasks.set(id, task);
  controllers.set(id, new AbortController());
  send('tasks:update', publicTask(task));
  return id;
}

function finishTask(id, status, detail) {
  updateTask(id, { status, detail, progress: status === 'completed' ? 100 : tasks.get(id)?.progress || 0 });
  controllers.delete(id);
}

const ERROR_LOG_FILE = path.join(DATA_ROOT, 'logs', 'error.log');

async function appendErrorLog({ title, item, error, extra = {} }) {
  try {
    await fsp.mkdir(path.dirname(ERROR_LOG_FILE), { recursive: true });
    const lines = [
      `[${new Date().toLocaleString('zh-CN', { hour12: false })}] 下载/安装失败`,
      `  任务：${title || '未知任务'}`,
    ];
    if (item) {
      lines.push(
        `  文件：${item.label || path.basename(item.destination || '') || '未知'}`,
        `  URL：${item.url || '未知'}`,
        `  保存位置：${item.destination || '未知'}`,
        `  期望大小：${item.size || 0} 字节`,
      );
    }
    lines.push(`  错误：${error?.message || String(error)}`);
    if (error?.cause) lines.push(`  原因：${error.cause.code || error.cause.message || String(error.cause)}`);
    for (const [key, value] of Object.entries(extra)) lines.push(`  ${key}：${value}`);
    lines.push('');
    await fsp.appendFile(ERROR_LOG_FILE, lines.join('\n') + '\n', 'utf8');
    return ERROR_LOG_FILE;
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30000),
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(options.headers || {}) },
      });
      if (!response.ok) throw new Error(`网络请求失败 (${response.status})：${new URL(url).hostname}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError' || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fileExists(file, expectedSize) {
  try {
    const stat = await fsp.stat(file);
    return stat.isFile() && (!expectedSize || stat.size === expectedSize);
  } catch {
    return false;
  }
}

function mirrorLibUrl(url) {
  // BMCLAPI 对 Fabric Maven 与 Mojang libraries 的镜像
  return String(url || '')
    .replace('https://maven.fabricmc.net', 'https://bmclapi2.bangbang93.com/maven')
    .replace('https://libraries.minecraft.net', 'https://bmclapi2.bangbang93.com/maven')
    .replace('https://meta.fabricmc.net', 'https://bmclapi2.bangbang93.com/fabric-meta');
}

async function downloadSingle(url, destination, { signal, onProgress, expectedSize = 0 } = {}) {
  if (await fileExists(destination, expectedSize)) {
    const stat = await fsp.stat(destination);
    onProgress?.(stat.size, stat.size);
    return { path: destination, size: stat.size, skipped: true };
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.part`;
  const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`下载失败 (${response.status})：${path.basename(destination)}`);
  if (!response.body) throw new Error('下载响应为空');
  const total = Number(response.headers.get('content-length')) || expectedSize;
  let received = 0;
  let lastNotice = 0;
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastNotice > 90 || received === total) {
      onProgress?.(received, total);
      lastNotice = now;
    }
  });
  try {
    await pipeline(source, fs.createWriteStream(temporary));
    if (total && received !== total) throw new Error('文件未完整下载，请重试');
    if (await fileExists(destination, expectedSize)) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      onProgress?.(received, total);
      return { path: destination, size: received, skipped: true };
    }
    try {
      await fsp.rename(temporary, destination);
    } catch (renameError) {
      if (renameError?.code === 'ENOENT' && await fileExists(destination)) {
        // 同目标的并发任务刚完成下载，文件已就位，视为成功
      } else {
        throw renameError;
      }
    }
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  onProgress?.(received, total);
  return { path: destination, size: received, skipped: false };
}

// 支持 url 或 urls（数组依次尝试）：官方源失败自动切换 BMCLAPI 镜像
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

async function downloadQueue(rawItems, taskId, concurrency = 6) {
  // 防御性去重：同一目标路径只下载一次
  const seen = new Set();
  const items = rawItems.filter((item) => {
    if (seen.has(item.destination)) return false;
    seen.add(item.destination);
    return true;
  });
  const totalBytes = items.reduce((sum, item) => sum + (item.size || 0), 0);
  const progressByFile = new Map();
  let cursor = 0;
  let completed = 0;
  let failure = null;
  const controller = controllers.get(taskId);
  updateTask(taskId, { total: totalBytes, detail: `共 ${items.length} 个文件` });

  async function worker() {
    while (!failure && cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        updateTask(taskId, { detail: item.label || path.basename(item.destination) });
        await downloadFile(item.urls || item.url, item.destination, {
          signal: controller?.signal,
          expectedSize: item.size,
          onProgress: (received) => {
            progressByFile.set(index, received);
            const currentBytes = [...progressByFile.values()].reduce((sum, value) => sum + value, 0);
            updateTask(taskId, {
              received: currentBytes,
              total: totalBytes,
              progress: totalBytes ? Math.min(99, (currentBytes / totalBytes) * 100) : Math.min(99, ((completed + 1) / items.length) * 100),
            });
          },
        });
        if (!progressByFile.has(index)) progressByFile.set(index, item.size || 0);
        completed++;
        if (!totalBytes) updateTask(taskId, { progress: (completed / items.length) * 100 });
      } catch (error) {
        if (!failure) {
          failure = error;
          failure.item = item;
          controller?.abort();
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failure) throw failure;
}

function currentOs() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

function rulesAllow(rules = [], features = {}) {
  if (!rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== currentOs()) matches = false;
      if (rule.os.arch && rule.os.arch !== (process.arch === 'x64' ? 'x64' : 'x86')) matches = false;
    }
    if (rule.features) {
      for (const [key, value] of Object.entries(rule.features)) {
        if (Boolean(features[key]) !== value) matches = false;
      }
    }
    if (matches) allowed = rule.action === 'allow';
  }
  return allowed;
}

function nativeSuffix() {
  return process.arch === 'x64' ? '64' : '32';
}

function libraryFiles(library, gameDir) {
  if (!rulesAllow(library.rules)) return [];
  const base = path.join(gameDir, 'libraries');
  const result = [];
  if (library.downloads?.artifact) {
    const artifact = library.downloads.artifact;
    result.push({ ...artifact, destination: path.join(base, artifact.path), native: false });
  } else if (library.name && library.url) {
    const [group, name, version] = library.name.split(':');
    const relative = `${group.replaceAll('.', '/')}/${name}/${version}/${name}-${version}.jar`;
    result.push({ url: `${library.url.replace(/\/$/, '')}/${relative}`, path: relative, size: 0, destination: path.join(base, relative), native: false });
  }
  const nativeKey = currentOs() === 'macos' && library.natives?.osx ? 'osx' : currentOs();
  const nativeName = library.natives?.[nativeKey];
  if (nativeName) {
    const classifier = nativeName.replace('${arch}', nativeSuffix());
    const native = library.downloads?.classifiers?.[classifier];
    if (native) result.push({ ...native, destination: path.join(base, native.path), native: true });
  }
  return result;
}

function mergeVersions(parent, child) {
  return {
    ...parent,
    ...child,
    libraries: [...(parent.libraries || []), ...(child.libraries || [])],
    arguments: child.arguments ? {
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments.jvm || [])],
      game: [...(parent.arguments?.game || []), ...(child.arguments.game || [])],
    } : parent.arguments,
    downloads: { ...(parent.downloads || {}), ...(child.downloads || {}) },
  };
}

async function resolveVersion(versionUrl) {
  const raw = await fetchJson(versionUrl);
  if (!raw.inheritsFrom) return raw;
  const manifest = await getVersionManifest(false);
  const parent = manifest.versions.find((item) => item.id === raw.inheritsFrom);
  if (!parent) throw new Error(`找不到父版本 ${raw.inheritsFrom}`);
  return mergeVersions(await resolveVersion(parent.url), raw);
}

async function getVersionManifest(refresh = false) {
  const cacheFile = path.join(CACHE_DIR, 'version-manifest.json');
  if (!refresh) {
    try {
      const cached = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
      if (Date.now() - cached.cachedAt < 15 * 60 * 1000) return cached.data;
    } catch {}
  }
  try {
    const data = await fetchJson(MANIFEST_URL);
    await fsp.writeFile(cacheFile, JSON.stringify({ cachedAt: Date.now(), data }));
    return data;
  } catch (error) {
    try {
      const cached = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
      return cached.data;
    } catch {
      throw error;
    }
  }
}

async function fetchText(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30000),
        headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
      });
      if (!response.ok) throw new Error(`网络请求失败 (${response.status})：${new URL(url).hostname}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError' || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

function compareBuildDesc(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff) return diff;
  }
  return String(b).localeCompare(String(a));
}

async function getForgeBuilds(mcVersion) {
  const prefix = `${mcVersion}-`;
  try {
    const xml = await fetchText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
    const builds = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map((m) => m[1])
      .filter((id) => id.startsWith(prefix))
      .map((id) => ({ id, build: id.slice(prefix.length) }))
      .sort((a, b) => compareBuildDesc(a.build, b.build));
    if (!builds.length) throw new Error(`Forge 暂不支持 Minecraft ${mcVersion}`);
    let recommended = null;
    let latest = null;
    try {
      const promos = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
      recommended = promos.promos?.[`${mcVersion}-recommended`] || null;
      latest = promos.promos?.[`${mcVersion}-latest`] || recommended;
    } catch {}
    return { builds, recommended, latest };
  } catch (error) {
    // 国内网络兜底：BMCLAPI 镜像
    try {
      const data = await fetchJson(`https://bmclapi2.bangbang93.com/forge/minecraft/${encodeURIComponent(mcVersion)}`);
      if (!Array.isArray(data) || !data.length) throw new Error(`Forge 暂不支持 Minecraft ${mcVersion}`);
      const builds = data
        .map((item) => ({ id: `${item.mcversion}-${item.version}`, build: String(item.version) }))
        .filter((item) => item.id.startsWith(prefix))
        .sort((a, b) => compareBuildDesc(a.build, b.build));
      return { builds, recommended: null, latest: null };
    } catch {
      throw error;
    }
  }
}

async function getNeoForgeBuilds(mcVersion) {
  // NeoForge 版本列表（BMCLAPI 提供 installerPath 完整 maven 路径；官方 maven 国内常直连不通）
  const prefix = `${mcVersion}-`;
  const data = await fetchJson(`https://bmclapi2.bangbang93.com/neoforge/list/${encodeURIComponent(mcVersion)}`);
  if (!Array.isArray(data) || !data.length) throw new Error(`NeoForge 暂不支持 Minecraft ${mcVersion}`);
  const builds = data
    .filter((item) => item.installerPath && (String(item.version).startsWith(prefix) || /^neoforge-\d/.test(String(item.rawVersion || ''))))
    .map((item) => ({ id: String(item.version), build: String(item.version).replace(prefix, ''), installerPath: item.installerPath }))
    .sort((a, b) => compareBuildDesc(a.build, b.build));
  if (!builds.length) throw new Error(`NeoForge 暂不支持 Minecraft ${mcVersion}`);
  // 列表升序时最后一项即最新；无官方 recommended 数据
  return { builds, recommended: null, latest: builds[0]?.build || null };
}

function neoforgeInstallerPath(forgeId) {
  // NeoForge 两种版本格式对应不同 maven 坐标：
  //   1.20.1-47.1.105（旧格式，mc 前缀）→ /maven/net/neoforged/forge/1.20.1-47.1.105/forge-1.20.1-47.1.105-installer.jar
  //   21.1.57（新格式，无前缀）→ /maven/net/neoforged/neoforge/21.1.57/neoforge-21.1.57-installer.jar
  const id = String(forgeId);
  if (/^\d+\.\d+\.\d+-/.test(id)) return `/maven/net/neoforged/forge/${id}/forge-${id}-installer.jar`;
  return `/maven/net/neoforged/neoforge/${id}/neoforge-${id}-installer.jar`;
}

async function getQuiltLoaders(mcVersion) {
  // Quilt 加载器版本列表（官方 meta API；profile json 与 Fabric 同构）
  const loaders = await fetchJson(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}`);
  if (!Array.isArray(loaders) || !loaders.length) throw new Error(`Quilt 暂不支持 Minecraft ${mcVersion}`);
  return { loaders: loaders.map((item) => item.loader.version) };
}

async function detectProxyJvmArgs() {
  // Forge 官方安装器不支持镜像参数，内部下载走官方源。
  // 如果用户开着系统代理，把代理注入安装器 JVM，让内部下载也能加速。
  if (process.platform !== 'win32') return [];
  try {
    const read = (value) => new Promise((resolve) => {
      execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', value], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
        resolve(error ? '' : String(stdout));
      });
    });
    const enableOut = await read('ProxyEnable');
    if (!/0x1/i.test(enableOut)) return [];
    const serverOut = await read('ProxyServer');
    const raw = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/)?.[1] || '';
    let httpsAddr = '';
    if (raw.includes('=')) {
      const map = {};
      for (const part of raw.split(';')) {
        const [proto, addr] = part.split('=');
        if (proto && addr) map[proto.trim().toLowerCase()] = addr.trim();
      }
      httpsAddr = map.https || map.http || '';
    } else {
      httpsAddr = raw;
    }
    const match = httpsAddr.match(/^([\w.-]+):(\d+)$/);
    if (!match) return [];
    const [, host, port] = match;
    return [
      `-Dhttps.proxyHost=${host}`, `-Dhttps.proxyPort=${port}`,
      `-Dhttp.proxyHost=${host}`, `-Dhttp.proxyPort=${port}`,
      '-Djava.net.useSystemProxies=true',
    ];
  } catch {
    return [];
  }
}

let cpolarChild = null;
const CPOLAR_WEB_PORT = 14040;
const CPOLAR_VERSION = '3.3.12';
const CPOLAR_ZIP_URLS = [
  `https://www.cpolar.com/static/downloads/releases/${CPOLAR_VERSION}/cpolar-stable-windows-amd64-setup.zip`,
  `http://www.cpolar.com/static/downloads/releases/${CPOLAR_VERSION}/cpolar-stable-windows-amd64-setup.zip`,
];

const cpolarExePath = () => path.join(DATA_ROOT, 'tools', 'cpolar', 'cpolar.exe');
const cpolarConfigPath = () => path.join(DATA_ROOT, 'tools', 'cpolar', 'cpolar-hcl.yml');

function sendCpolarOutput(text) {
  const match = text.match(/tcp:\/\/([a-z0-9.-]+):(\d{2,5})/i);
  if (match) send('net:cpolar-address', { address: `${match[1]}:${match[2]}` });
  send('net:cpolar-log', { text });
}

async function pollCpolarAddress() {
  for (let i = 0; i < 20; i++) {
    if (!cpolarChild) return;
    try {
      const res = await fetch(`http://127.0.0.1:${CPOLAR_WEB_PORT}/api/tunnels`);
      if (res.ok) {
        const data = await res.json();
        const tunnel = (data.tunnels || []).find((item) => (item.public_url || '').startsWith('tcp://'));
        if (tunnel) {
          send('net:cpolar-address', { address: tunnel.public_url.replace('tcp://', '') });
          return;
        }
      }
    } catch { /* cpolar web API 未就绪，继续等 */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function installVersion(version, name, loader = 'Vanilla', forgeId = null, shaderLoader = null) {
  const taskId = createTask('game', `安装 Minecraft ${version.id}${loader !== 'Vanilla' ? ` · ${loader}` : ''}${shaderLoader === 'Iris' ? ' · Iris 光影' : ''}`);
  let attemptDir = null;
  let finishDetail = null;
  try {
    const manifest = await getVersionManifest(false);
    const entry = manifest.versions.find((item) => item.id === version.id);
    if (!entry) throw new Error('版本清单中不存在此版本');
    const instanceName = (name || `Minecraft ${version.id}`).trim().slice(0, 40);
    let meta = null;
    let vanillaMeta = null;
    let runtimeVersion;
    if (loader === 'Fabric' || loader === 'Quilt') {
      // Quilt profile json 与 Fabric 完全同构，复用同一条安装路径
      const isQuilt = loader === 'Quilt';
      updateTask(taskId, { detail: `获取 ${loader} 加载器…`, progress: 1 });
      const metaBase = isQuilt
        ? `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(version.id)}`
        : `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version.id)}`;
      const mirrorBase = isQuilt
        ? `https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/${encodeURIComponent(version.id)}`
        : `https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/${encodeURIComponent(version.id)}`;
      let loaders;
      let selectedLoaderVersion;
      if (isQuilt) {
        // Quilt：v3 API 返回 loader 数组，选择最新稳定版
        const quiltData = await fetchJson(metaBase).catch(async (error) => {
          if (error.name === 'AbortError') throw error;
          const fallback = await fetchJson(mirrorBase).catch(() => null);
          if (fallback) return fallback.map((item) => ({ loader: { version: item.loader?.version || item.version } }));
          throw error;
        });
        if (!quiltData.length) throw new Error(`Quilt 暂不支持 Minecraft ${version.id}`);
        selectedLoaderVersion = quiltData[0].loader.version;
        const quiltProfileUrl = `${metaBase}/${encodeURIComponent(selectedLoaderVersion)}/profile/json`;
        try {
          meta = await resolveVersion(quiltProfileUrl);
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          throw error;
        }
      } else {
        try {
          loaders = await fetchJson(metaBase);
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          loaders = await fetchJson(mirrorBase);
        }
        if (!loaders.length) throw new Error(`Fabric 暂不支持 Minecraft ${version.id}`);
        const selectedLoader = loaders.find((item) => item.loader.stable) || loaders[0];
        const profileUrl = `${metaBase}/${encodeURIComponent(selectedLoader.loader.version)}/profile/json`;
        try {
          meta = await resolveVersion(profileUrl);
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          meta = await resolveVersion(profileUrl.replace('https://meta.fabricmc.net', 'https://bmclapi2.bangbang93.com/fabric-meta'));
        }
      }
      runtimeVersion = meta.id || version.id;
    } else if (loader === 'NeoForge') {
      if (!forgeId) throw new Error('请选择要安装的 NeoForge 版本');
      updateTask(taskId, { detail: '读取原版版本信息…', progress: 1 });
      vanillaMeta = await resolveVersion(entry.url);
      runtimeVersion = String(forgeId);
    } else if (loader === 'Forge') {
      if (!forgeId) throw new Error('请选择要安装的 Forge 版本');
      updateTask(taskId, { detail: '读取原版版本信息…', progress: 1 });
      vanillaMeta = await resolveVersion(entry.url);
      runtimeVersion = `${version.id}-forge-${forgeId.slice(version.id.length + 1) || forgeId}`;
    } else {
      meta = await resolveVersion(entry.url);
      runtimeVersion = meta.id || version.id;
    }
    const id = `${runtimeVersion.replace(/[^a-zA-Z0-9._-]/g, '-')}-${Date.now().toString(36)}`;
    const gameDir = path.join(settings.gameDirectory, 'instances', id);
    attemptDir = gameDir;
    const versionDir = path.join(gameDir, 'versions', runtimeVersion);
    await fsp.mkdir(versionDir, { recursive: true });
    updateTask(taskId, { detail: '读取版本信息…', progress: 1 });
    const isInstallerLoader = loader === 'Forge' || loader === 'NeoForge';
    if (!isInstallerLoader) {
      await fsp.writeFile(path.join(versionDir, `${runtimeVersion}.json`), JSON.stringify(meta, null, 2));
    }
    const assetMeta = isInstallerLoader ? vanillaMeta : meta;
    const assetIndexUrl = assetMeta?.assetIndex?.url;
    if (!assetIndexUrl) throw new Error('此版本缺少资源索引');
    const assetIndexPath = path.join(gameDir, 'assets', 'indexes', `${assetMeta.assetIndex.id}.json`);
    await downloadFile(assetIndexUrl, assetIndexPath, { signal: controllers.get(taskId)?.signal, expectedSize: assetMeta.assetIndex.size });
    const assetIndex = JSON.parse(await fsp.readFile(assetIndexPath, 'utf8'));
    // 资源索引中多个路径可能共用同一哈希，按目标路径去重，避免并发写同一文件
    const downloads = [];
    const seenDestinations = new Set();
    const pushDownload = (item) => {
      if (seenDestinations.has(item.destination)) return false;
      seenDestinations.add(item.destination);
      downloads.push(item);
      return true;
    };
    const nativeLibraries = [];
    if (loader === 'Forge' || loader === 'NeoForge') {
      const isNeo = loader === 'NeoForge';
      updateTask(taskId, { detail: `下载 ${loader} 官方安装器…`, progress: 2 });
      const installerPath = path.join(CACHE_DIR, 'forge', `${loader.toLowerCase()}-${forgeId}-installer.jar`);
      const installerUrls = isNeo
        ? [
          `https://bmclapi2.bangbang93.com${neoforgeInstallerPath(forgeId)}`,
          `https://maven.neoforged.net/net/neoforged/neoforge/${forgeId}/neoforge-${forgeId}-installer.jar`,
        ]
        : [
          `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeId}/forge-${forgeId}-installer.jar`,
          `https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/${forgeId}/forge-${forgeId}-installer.jar`,
        ];
      let installerError = null;
      for (const url of installerUrls) {
        try {
          await downloadFile(url, installerPath, {
            signal: controllers.get(taskId)?.signal,
            onProgress: (received, total) => updateTask(taskId, {
              progress: total ? Math.min(9, 2 + (received / total) * 7) : 3,
              detail: `下载 ${loader} 安装器 ${(received / 1048576).toFixed(1)} MB`,
            }),
          });
          installerError = null;
          break;
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          installerError = error;
        }
      }
      if (installerError) throw installerError;
      let java;
      const need = requiredJavaMajorFallback(version.id);
      const usable = (await listJavas()).filter((item) => item.major >= need);
      if (usable.length) java = usable.sort((a, b) => a.major - b.major)[0];
      else if (settings.autoDownloadJava !== false) {
        updateTask(taskId, { detail: `未找到 Java ${need}，正在自动下载…` });
        await downloadJavaRuntime(pickDownloadMajor(need));
        java = (await listJavas()).filter((item) => item.major >= need).sort((a, b) => a.major - b.major)[0];
      }
      if (!java) {
        const error = new Error(`安装 ${loader} 需要先安装 Java ${need}，请到“设置 → Java 环境”配置或开启自动下载`);
        error.code = 'NO_JAVA';
        throw error;
      }
      updateTask(taskId, { detail: `正在运行 ${loader} 官方安装器（下载运行库并打补丁，需要几分钟）…`, progress: 10 });
      const proxyArgs = await detectProxyJvmArgs();
      if (proxyArgs.length) updateTask(taskId, { detail: `正在运行 ${loader} 官方安装器（已复用系统代理加速下载）…`, progress: 10 });
      await new Promise((resolve, reject) => {
        execFile(java.path, [...proxyArgs, '-jar', installerPath, '--installClient', gameDir], {
          timeout: 15 * 60 * 1000,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`${loader} 安装器运行失败：${String(stderr || stdout || error.message).trim().slice(-400)}`));
            return;
          }
          resolve();
        });
      });
      updateTask(taskId, { detail: `定位 ${loader} 版本文件…`, progress: 20 });
      const versionsRoot = path.join(gameDir, 'versions');
      const versionDirs = await fsp.readdir(versionsRoot, { withFileTypes: true });
      let found = null;
      for (const dir of versionDirs) {
        if (!dir.isDirectory()) continue;
        const jsonPath = path.join(versionsRoot, dir.name, `${dir.name}.json`);
        try {
          const parsed = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
          // NeoForge 版本 id 有两种格式：1.20.1-forge-47.1.105 / neoforge-21.1.57（无前缀）
          const isLoaderId = String(parsed.id || '').includes('forge');
          if (parsed.inheritsFrom === version.id && isLoaderId) {
            const stat = await fsp.stat(jsonPath);
            if (!found || stat.mtimeMs > found.mtime) found = { id: parsed.id, dir: dir.name, mtime: stat.mtimeMs };
          }
        } catch {}
      }
      if (!found) throw new Error(`${loader} 安装器未生成版本文件，请查看失败日志后重试`);
      runtimeVersion = found.id;
      versionDir = path.join(versionsRoot, found.dir);
    } else {
      if (!meta.downloads?.client) throw new Error('此版本缺少客户端下载信息');
      pushDownload({ ...meta.downloads.client, destination: path.join(versionDir, `${runtimeVersion}.jar`), label: '游戏客户端' });
      for (const library of meta.libraries || []) {
        for (const file of libraryFiles(library, gameDir)) {
          const libUrls = [...new Set([file.url, mirrorLibUrl(file.url)].filter(Boolean))];
          if (pushDownload({ ...file, url: file.url, urls: libUrls, label: path.basename(file.destination) }) && file.native) {
            nativeLibraries.push(file.destination);
          }
        }
      }
      if (meta.logging?.client?.file) {
        const logFile = meta.logging.client.file;
        pushDownload({ ...logFile, destination: path.join(gameDir, 'assets', 'log_configs', logFile.id), label: '日志配置' });
      }
    }
    for (const [assetPath, object] of Object.entries(assetIndex.objects || {})) {
      const objectHash = object.hash;
      pushDownload({
        url: `https://resources.download.minecraft.net/${objectHash.slice(0, 2)}/${objectHash}`,
        size: object.size,
        destination: path.join(gameDir, 'assets', 'objects', objectHash.slice(0, 2), objectHash),
        label: `游戏资源 ${assetPath.split('/').pop() || objectHash.slice(0, 8)}`,
      });
    }
    await downloadQueue(downloads, taskId, 8);
    await fsp.mkdir(path.join(gameDir, 'mods'), { recursive: true });
    await fsp.mkdir(path.join(gameDir, 'shaderpacks'), { recursive: true });
    await fsp.mkdir(path.join(gameDir, 'saves'), { recursive: true });
    // 光影加载器（Iris）：游戏主体装完后自动下载 Iris + Sodium + FFAPI 到 mods
    if (shaderLoader === 'Iris') {
      updateTask(taskId, { detail: '下载光影加载器组件（Iris / Sodium / FFAPI）…', progress: 96 });
      const count = await downloadShaderLoaderPack(gameDir, version.id, loader, taskId);
      finishDetail = `安装完成 · ${downloads.length + count} 个文件（含 Iris 光影组件）`;
    }
    const instance = {
      id, name: instanceName, version: version.id, runtimeVersion, type: version.type, loader,
      gameDir, versionDir, createdAt: Date.now(), lastPlayed: null,
    };
    instances.unshift(instance);
    settings.selectedInstanceId = id;
    await Promise.all([
      fsp.writeFile(INSTANCES_FILE, JSON.stringify(instances, null, 2)),
      fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2)),
    ]);
    finishTask(taskId, 'completed', finishDetail || `安装完成 · ${downloads.length} 个文件`);
    send('instances:update', { instances, selectedInstanceId: id });
    return { instance, taskId };
  } catch (error) {
    const failedItem = error?.item;
    await appendErrorLog({
      title: `安装 Minecraft ${version.id}${loader !== 'Vanilla' ? ` · ${loader}` : ''}`,
      item: failedItem,
      error,
      extra: { 游戏版本: version.id, 加载器: loader, ...((loader === 'Forge' || loader === 'NeoForge') && forgeId ? { [`${loader} 版本`]: forgeId } : {}) },
    });
    finishTask(taskId, error.name === 'AbortError' ? 'cancelled' : 'error', error.message);
    if (attemptDir) {
      try {
        if (fs.existsSync(attemptDir)) await shell.trashItem(attemptDir);
      } catch {}
    }
    throw error;
  }
}

async function listJavas() {
  const executableName = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];
  if (settings.javaPath) candidates.push(settings.javaPath);
  // 启动器托管运行时（自动下载的 Java）
  try {
    for (const entry of await fsp.readdir(JAVA_MANAGED_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(JAVA_MANAGED_ROOT, entry.name);
      candidates.push(path.join(dir, 'bin', executableName));
      candidates.push(path.join(dir, 'Contents', 'Home', 'bin', executableName));
      try {
        for (const sub of await fsp.readdir(dir, { withFileTypes: true })) {
          if (sub.isDirectory()) candidates.push(path.join(dir, sub.name, 'bin', executableName));
        }
      } catch {}
    }
  } catch {}
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', executableName));
  if (process.platform === 'darwin') {
    const macRoots = ['/Library/Java/JavaVirtualMachines', path.join(os.homedir(), 'Library', 'Java', 'JavaVirtualMachines')];
    for (const root of macRoots) {
      try {
        const entries = await fsp.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) candidates.push(path.join(root, entry.name, 'Contents', 'Home', 'bin', 'java'));
        }
      } catch {}
    }
    candidates.push('/usr/bin/java');
  } else {
    const roots = process.platform === 'win32' ? [
      'C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Amazon Corretto', 'C:\\Program Files\\BellSoft', 'D:\\Java', 'D:\\Program Files\\Java',
      'D:\\Program Files\\Eclipse Adoptium',
    ] : ['/usr/bin'];
    for (const root of roots) {
      try {
        if (root === '/usr/bin') {
          candidates.push('/usr/bin/java');
          continue;
        }
        const entries = await fsp.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) candidates.push(path.join(root, entry.name, 'bin', 'java.exe'));
        }
      } catch {}
    }
    if (process.platform === 'win32') candidates.push('java.exe');
    else candidates.push('/usr/bin/java');
  }
  const results = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const version = await new Promise((resolve, reject) => {
        execFile(candidate, ['-version'], { timeout: 5000, windowsHide: true }, (error, _stdout, stderr) => {
          if (error) return reject(error);
          const match = stderr.match(/version "([^"]+)"/);
          resolve(match?.[1] || stderr.split('\n')[0] || '未知版本');
        });
      });
      results.push({ path: candidate, version, major: parseJavaMajor(version) });
    } catch {}
  }
  const seen = new Set();
  return results.filter((item) => (seen.has(item.path) ? false : seen.add(item.path)));
}

async function detectJava() {
  const list = await listJavas();
  if (!list.length) return { found: false, path: '', version: '', major: 0 };
  return { found: true, ...list[0] };
}

// ---------- 启动前内存优化（PCL2 同款思路：压缩各进程工作集） ----------

const MEMORY_OPTIMIZE_PS = `
$sig = '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);'
Add-Type -MemberDefinition $sig -Name Kernel -Namespace Win32 | Out-Null
$before = [Math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
Get-Process | ForEach-Object { try { [Win32.Kernel]::EmptyWorkingSet($_.Handle) } catch {} } | Out-Null
Start-Sleep -Milliseconds 500
$after = [Math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
$after - $before
`;

async function optimizeMemory() {
  if (process.platform !== 'win32') return 0;
  try {
    const encoded = Buffer.from(MEMORY_OPTIMIZE_PS, 'utf16le').toString('base64');
    const { stdout } = await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out) => err ? reject(err) : resolve({ stdout: out }));
    });
    const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
    const freed = parseInt(lines[lines.length - 1], 10);
    return Number.isFinite(freed) ? Math.max(0, freed) : 0;
  } catch { return 0; }
}

// ---------- Java 自动匹配与下载 ----------

const JAVA_MANAGED_ROOT = path.join(DATA_ROOT, 'runtime');

function parseJavaMajor(version) {
  const m = String(version).match(/^(1\.)?(\d+)/);
  if (!m) return 0;
  return Number(m[2]); // "1.8.0_402" → 8，"21.0.5" → 21，"17.0.14" → 17
}

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

async function requiredJavaMajor(instance) {
  try {
    let meta = JSON.parse(await fsp.readFile(path.join(instance.versionDir, `${instance.runtimeVersion || instance.version}.json`), 'utf8'));
    while (meta && !meta.javaVersion && meta.inheritsFrom) {
      const parentId = String(meta.inheritsFrom);
      if (/[\\/]+|\.\./.test(parentId)) break;
      meta = JSON.parse(await fsp.readFile(path.join(instance.versionDir, '..', parentId, `${parentId}.json`), 'utf8'));
    }
    if (meta?.javaVersion?.majorVersion) return meta.javaVersion.majorVersion;
  } catch {}
  return requiredJavaMajorFallback(instance.version);
}

function pickDownloadMajor(required) {
  if (required <= 8) return 8;
  if (required <= 11) return 11;
  if (required <= 17) return 17; // 含 16：Adoptium 无 16，17 兼容
  return 21;                     // 18+ 及 21+ 快照尽力给 21
}

async function downloadJavaRuntime(major) {
  const taskId = createTask('java', `下载 Java ${major} 运行时`);
  try {
    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const archName = process.arch === 'arm64' ? 'aarch64' : 'x64';
    updateTask(taskId, { detail: '正在查询 Adoptium 版本信息…', progress: 2 });
    const info = await fetchJson(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${archName}&image_type=jre&os=${osName}&project=jdk`);
    const asset = Array.isArray(info) ? info.find((item) => item?.binary?.package?.link) : null;
    if (!asset) throw new Error(`未找到 Java ${major} 运行时（Adoptium）`);
    const packageName = asset.binary.package.name;
    const links = [];
    if (osName === 'windows' || osName === 'mac') {
      links.push(`https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/${archName}/${osName}/${packageName}`);
    }
    links.push(asset.binary.package.link, `https://ghproxy.net/${asset.binary.package.link}`);
    const runtimeRoot = JAVA_MANAGED_ROOT;
    const targetDir = path.join(runtimeRoot, `java-${major}`);
    await fsp.mkdir(targetDir, { recursive: true });
    const archivePath = path.join(runtimeRoot, packageName);
    await downloadFile(links, archivePath, {
      expectedSize: asset.binary.package.size || 0,
      onProgress: (received, total) => updateTask(taskId, {
        received, total,
        progress: total ? Math.min(95, (received / total) * 100) : 0,
        detail: `${(received / 1048576).toFixed(1)} MB / ${total ? (total / 1048576).toFixed(1) : '?'} MB`,
      }),
    });
    updateTask(taskId, { progress: 96, detail: '正在解压…' });
    if (packageName.endsWith('.zip')) {
      new AdmZip(archivePath).extractAllTo(targetDir, true);
    } else {
      await new Promise((resolve, reject) => {
        const child = spawn('tar', ['xzf', archivePath, '-C', targetDir], { windowsHide: true });
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`解压 Java 失败（代码 ${code}）`)));
        child.on('error', reject);
      });
    }
    // 归一层级：把 jdk-xxx-jre/ 的内容上移，保证 bin/java 位于 java-{major}/bin
    const exeName = process.platform === 'win32' ? 'java.exe' : 'java';
    if (!fs.existsSync(path.join(targetDir, 'bin', exeName))) {
      const entries = await fsp.readdir(targetDir, { withFileTypes: true });
      const inner = entries.find((entry) => entry.isDirectory() && fs.existsSync(path.join(targetDir, entry.name, 'bin', exeName)));
      if (!inner) throw new Error('Java 压缩包结构异常');
      const innerDir = path.join(targetDir, inner.name);
      for (const entry of await fsp.readdir(innerDir, { withFileTypes: true })) {
        await fsp.rename(path.join(innerDir, entry.name), path.join(targetDir, entry.name));
      }
      await fsp.rm(innerDir, { recursive: true, force: true });
    }
    if (process.platform !== 'win32') await fsp.chmod(path.join(targetDir, 'bin', exeName), 0o755).catch(() => {});
    await fsp.rm(archivePath, { force: true }).catch(() => {});
    finishTask(taskId, 'completed', `Java ${major} 已安装到 ${targetDir}`);
    return targetDir;
  } catch (error) {
    finishTask(taskId, 'error', error.message || 'Java 下载失败');
    throw error;
  }
}

async function resolveJavaForInstance(instance) {
  const required = await requiredJavaMajor(instance);
  const usable = (await listJavas()).filter((item) => item.major >= required);
  if (usable.length) {
    const score = (item) => (item.path === settings.javaPath ? 0 : item.major === required ? 1 : 2);
    usable.sort((a, b) => score(a) - score(b) || a.major - b.major);
    return { java: usable[0], required, downloaded: false };
  }
  if (settings.autoDownloadJava === false) {
    const error = new Error(`这个实例需要 Java ${required}，但本机没有可用的 Java。可在“设置 → Java 环境”开启自动下载或手动配置。`);
    error.code = 'NO_JAVA';
    throw error;
  }
  await downloadJavaRuntime(pickDownloadMajor(required));
  const after = (await listJavas()).filter((item) => item.major >= required);
  if (!after.length) {
    const error = new Error(`Java ${required} 自动下载后仍不可用，请到“设置 → Java 环境”手动配置`);
    error.code = 'NO_JAVA';
    throw error;
  }
  after.sort((a, b) => a.major - b.major);
  return { java: after[0], required, downloaded: true };
}

function offlineUuid(username) {
  const hex = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function argumentValues(items, features = {}) {
  const values = [];
  for (const item of items || []) {
    if (typeof item === 'string') values.push(item);
    else if (rulesAllow(item.rules, features)) {
      if (Array.isArray(item.value)) values.push(...item.value);
      else if (item.value) values.push(item.value);
    }
  }
  return values;
}

function legacyLangCode(versionId) {
  const m = String(versionId).match(/1\.(\d+)/);
  return (m && Number(m[1]) <= 12) ? 'zh_CN' : 'zh_cn';
}

async function ensureGameLanguage(gameDir, versionId) {
  // 与 PCL2/HMCL 一致：启动前把实例 options.txt 的语言写为简体中文，新实例首次进入即为中文界面
  if (settings.autoChineseLang === false) return;
  try {
    const optionsPath = path.join(gameDir, 'options.txt');
    let content = '';
    try {
      content = await fsp.readFile(optionsPath, 'utf8');
    } catch {}
    const langLine = `lang:${legacyLangCode(versionId)}`;
    if (/(^|\n)lang:[^\n]*/i.test(content)) {
      content = content.replace(/(^|\n)lang:[^\n]*/i, (m, p1) => `${p1}${langLine}`);
    } else {
      content = `${langLine}\n${content}`;
    }
    await fsp.writeFile(optionsPath, content, 'utf8');
  } catch {}
}

async function ensureAuthlibInjector() {
  // 外置登录核心组件（authlib-injector），官方源失败走 BMCLAPI 镜像
  const dest = path.join(DATA_ROOT, 'authlib-injector.jar');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) return dest;
  const mirrorBase = 'https://bmclapi2.bangbang93.com/mirrors/authlib-injector';
  let info;
  try {
    info = await fetchJson('https://authlib-injector.yushi.moe/artifact/latest.json');
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    info = await fetchJson(`${mirrorBase}/artifact/latest.json`);
  }
  const official = info.url;
  await downloadFile([official, official.replace('https://authlib-injector.yushi.moe', mirrorBase)], dest, { expectedSize: info.size || 0 });
  return dest;
}

async function launchGame(instanceId) {
  const instance = instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('请先选择游戏实例');
  if (gameProcesses.has(instanceId)) throw new Error('这个实例已经在运行中');
  // 启动前内存优化：可用内存不足 3GB 时自动压缩各进程工作集
  if (process.platform === 'win32' && settings.memoryOptimize !== false && os.freemem() < 3 * 1024 * 1024 * 1024) {
    const freed = await optimizeMemory();
    if (freed > 0) send('app:toast', { message: `启动前内存优化完成，已释放 ${freed} MB 可用空间`, type: 'info' });
  }
  const { java } = await resolveJavaForInstance(instance);
  const runtimeVersion = instance.runtimeVersion || instance.version;
  const metaPath = path.join(instance.versionDir, `${runtimeVersion}.json`);
  let meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
  if (meta.inheritsFrom) {
    // Forge 等基于原版的加载器：按 inheritsFrom 合并父版本（原版）配置
    const parentId = String(meta.inheritsFrom);
    if (/[\\/]+|\.\./.test(parentId)) throw new Error('版本继承信息异常');
    const parentPath = path.join(instance.versionDir, '..', parentId, `${parentId}.json`);
    const parent = JSON.parse(await fsp.readFile(parentPath, 'utf8'));
    meta = mergeVersions(parent, meta);
  }
  const gameDir = instance.gameDir;
  const nativesDir = path.join(instance.versionDir, 'natives');
  await fsp.mkdir(nativesDir, { recursive: true });
  const classpath = [];
  for (const library of meta.libraries || []) {
    for (const file of libraryFiles(library, gameDir)) {
      if (file.native) {
        const zip = new AdmZip(file.destination);
        for (const entry of zip.getEntries()) {
          if (!entry.isDirectory && !entry.entryName.startsWith('META-INF/')) zip.extractEntryTo(entry, nativesDir, false, true);
        }
      } else classpath.push(file.destination);
    }
  }
  const clientJar = path.join(instance.versionDir, `${runtimeVersion}.jar`);
  classpath.push(clientJar);
  const account = accounts.find((a) => a.id === settings.currentAccountId) || accounts[0] || null;
  const username = (account?.name || settings.username || 'Player').trim() || 'Player';
  const authUuid = account?.type === 'yggdrasil' && account.uuid ? account.uuid : offlineUuid(username);
  const authToken = account?.type === 'yggdrasil' && account.accessToken ? account.accessToken : '0';
  const values = {
    auth_player_name: username,
    version_name: instance.version,
    game_directory: gameDir,
    assets_root: path.join(gameDir, 'assets'),
    assets_index_name: meta.assetIndex?.id || meta.assets,
    auth_uuid: authUuid,
    auth_access_token: authToken,
    clientid: '0',
    auth_xuid: '0',
    user_type: 'msa',
    version_type: meta.type || 'release',
    natives_directory: nativesDir,
    launcher_name: 'HCL',
    launcher_version: app.getVersion(),
    classpath: classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: path.join(gameDir, 'libraries'),
    game_assets: path.join(gameDir, 'assets'),
  };
  const replaceArgs = (args) => args.map((arg) => arg.replace(/\$\{([^}]+)\}/g, (_, key) => values[key] ?? ''));
  const jvmArgs = [`-Xmx${Number(settings.memory) || 4096}M`, '-Xms512M', '-Dfile.encoding=UTF-8'];
  if (account?.type === 'yggdrasil' && account.apiRoot) {
    try {
      const agentJar = await ensureAuthlibInjector();
      jvmArgs.unshift(`-javaagent:${agentJar}=${account.apiRoot}`);
    } catch (error) {
      send('game:log', { instanceId, text: `外置登录组件下载失败：${error.message}（将以内置身份尝试）` });
    }
  }
  if (meta.arguments?.jvm) jvmArgs.push(...argumentValues(meta.arguments.jvm));
  else jvmArgs.push(`-Djava.library.path=${nativesDir}`, `-cp`, classpath.join(path.delimiter));
  const mainClass = meta.mainClass;
  if (!mainClass) throw new Error('版本信息中缺少启动类');
  const gameArgs = meta.arguments?.game ? argumentValues(meta.arguments.game) : (meta.minecraftArguments || '').split(' ');
  const args = [...replaceArgs(jvmArgs), mainClass, ...replaceArgs(gameArgs)].filter(Boolean);
  await ensureGameLanguage(gameDir, instance.version);
  const child = spawn(java.path, args, { cwd: gameDir, windowsHide: false });
  gameProcesses.set(instanceId, child);
  instance.lastPlayed = Date.now();
  await fsp.writeFile(INSTANCES_FILE, JSON.stringify(instances, null, 2));
  send('instances:update', { instances, selectedInstanceId: settings.selectedInstanceId });
  child.stdout.on('data', (data) => send('game:log', { instanceId, text: data.toString() }));
  child.stderr.on('data', (data) => send('game:log', { instanceId, text: data.toString() }));
  child.on('error', (error) => {
    gameProcesses.delete(instanceId);
    send('game:log', { instanceId, text: `启动失败：${error.message}` });
  });
  child.on('exit', (code) => {
    gameProcesses.delete(instanceId);
    send('game:log', { instanceId, text: `游戏进程已退出（代码 ${code ?? '未知'}）`, exited: true });
  });
  return { pid: child.pid, java: java.path };
}

async function searchModrinth(options) {
  const { query = '', kind = 'mod', gameVersion = '', loader = '', sort = 'relevance', offset = 0 } = options;
  const facets = [[`project_type:${kind === 'shader' ? 'shader' : 'mod'}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader && kind === 'mod') facets.push([`categories:${loader.toLowerCase()}`]);
  const params = new URLSearchParams({ query, limit: '24', offset: String(offset), index: sort, facets: JSON.stringify(facets) });
  return fetchJson(`https://api.modrinth.com/v2/search?${params}`);
}

async function projectVersions(projectId, options = {}) {
  const params = new URLSearchParams();
  if (options.gameVersion) params.set('game_versions', JSON.stringify([options.gameVersion]));
  if (options.loader && options.kind === 'mod') params.set('loaders', JSON.stringify([options.loader.toLowerCase()]));
  const query = params.toString();
  return fetchJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version${query ? `?${query}` : ''}`);
}

async function downloadResource(resource) {
  const instance = instances.find((item) => item.id === resource.instanceId);
  if (!instance) throw new Error('请先在首页选择游戏实例');
  const file = resource.file;
  if (!file?.url || !file?.filename) throw new Error('资源文件信息不完整');
  const safeName = path.basename(file.filename).replace(/[<>:"|?*]/g, '-');
  const folder = resource.kind === 'shader' ? 'shaderpacks' : 'mods';
  const destination = path.join(instance.gameDir, folder, safeName);
  const taskId = createTask(resource.kind, `${resource.projectTitle} · ${safeName}`, file.size || 0);
  try {
    await downloadFile(file.url, destination, {
      signal: controllers.get(taskId)?.signal,
      expectedSize: file.size || 0,
      onProgress: (received, total) => updateTask(taskId, {
        received, total, progress: total ? Math.min(99, (received / total) * 100) : 0,
        detail: `${(received / 1048576).toFixed(1)} MB / ${total ? (total / 1048576).toFixed(1) : '?'} MB`,
      }),
    });
    finishTask(taskId, 'completed', `已保存到 ${instance.name} / ${folder}`);
    return { path: destination, taskId };
  } catch (error) {
    await appendErrorLog({
      title: `${resource.projectTitle || 'Modrinth 资源'} · ${safeName}`,
      item: { url: file.url, destination, size: file.size || 0, label: safeName },
      error,
      extra: { 目标实例: instance.name, 资源类型: resource.kind === 'shader' ? '光影' : 'Mod' },
    });
    finishTask(taskId, error.name === 'AbortError' ? 'cancelled' : 'error', error.message);
    throw error;
  }
}

async function fetchLatestModrinthFile(projectSlug, gameVersion, loaders) {
  // 取 Modrinth 项目在指定版本+加载器下最新的 release 文件
  const params = new URLSearchParams();
  params.set('game_versions', JSON.stringify([gameVersion]));
  if (loaders?.length) params.set('loaders', JSON.stringify(loaders));
  const versions = await fetchJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectSlug)}/version?${params}`);
  if (!Array.isArray(versions) || !versions.length) return null;
  const release = versions.find((v) => v.version_type === 'release') || versions[0];
  const file = (release.files || []).find((f) => f.primary) || (release.files || [])[0];
  return file ? { url: file.url, filename: file.filename, size: file.size || 0, version: release.version_number } : null;
}

async function downloadShaderLoaderPack(gameDir, mcVersion, modLoader, parentTaskId) {
  // Iris 光影加载器组件包：Iris 本体 + Sodium（性能） + FFAPI（Fabric API 依赖）
  // Quilt 亦使用 fabric 标签的构建；Iris 自 1.20 起不再要求独立 FFAPI 版本，但保留以兼容旧版
  const loaderTag = modLoader === 'Fabric' || modLoader === 'Quilt' ? ['fabric'] : [];
  const components = [
    { slug: 'iris', label: 'Iris 光影加载器', fallback: 'https://api.modrinth.com/v2/project/iris/version' },
    { slug: 'sodium', label: 'Sodium 性能优化', fallback: 'https://api.modrinth.com/v2/project/sodium/version' },
    { slug: 'fabric-api', label: 'Fabric API', fallback: 'https://api.modrinth.com/v2/project/fabric-api/version' },
  ];
  let downloaded = 0;
  const failures = [];
  for (let i = 0; i < components.length; i += 1) {
    const item = components[i];
    updateTask(parentTaskId, { detail: `下载光影组件 ${i + 1}/${components.length}：${item.label}…`, progress: 96 + i });
    try {
      let file = null;
      try {
        file = await fetchLatestModrinthFile(item.slug, mcVersion, loaderTag);
      } catch {
        file = null;
      }
      if (!file && loaderTag.length) {
        // 严格过滤无结果时放宽：不限定加载器（Iris 对 quilt 也发布 fabric 构建）
        try { file = await fetchLatestModrinthFile(item.slug, mcVersion, null); } catch { file = null; }
      }
      if (!file) {
        failures.push(`${item.label}：未找到 Minecraft ${mcVersion} 的可用版本`);
        continue;
      }
      const destination = path.join(gameDir, 'mods', path.basename(file.filename).replace(/[<>:"|?*]/g, '-'));
      await downloadFile(file.url, destination, {
        signal: controllers.get(parentTaskId)?.signal,
        expectedSize: file.size,
      });
      downloaded += 1;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      failures.push(`${item.label}：${error.message}`);
    }
  }
  if (failures.length) {
    await appendErrorLog({
      title: `光影加载器组件下载（Minecraft ${mcVersion}）`,
      error: new Error(failures.join('；')),
      extra: { 游戏版本: mcVersion, 加载器: modLoader },
    });
  }
  return downloaded;
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => ({ settings, instances, tasks: [...tasks.values()], dataRoot: DATA_ROOT, appVersion: app.getVersion(), platform: process.platform, running: [...gameProcesses.keys()] }));
  ipcMain.handle('settings:save', async (_event, next) => {
    settings = { ...settings, ...next };
    if (!settings.username.trim()) settings.username = 'Player';
    settings.memory = Math.max(1024, Math.min(32768, Number(settings.memory) || 4096));
    await fsp.mkdir(settings.gameDirectory, { recursive: true });
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    scheduleNextUpdateCheck(6000);
    return settings;
  });
  ipcMain.handle('versions:list', (_event, refresh) => getVersionManifest(refresh));
  ipcMain.handle('versions:install', (_event, version, name, loader, forgeId, shaderLoader) => installVersion(version, name, loader, forgeId, shaderLoader));
  ipcMain.handle('forge:list', (_event, mcVersion) => getForgeBuilds(mcVersion));
  ipcMain.handle('neoforge:list', (_event, mcVersion) => getNeoForgeBuilds(mcVersion));
  ipcMain.handle('quilt:list', (_event, mcVersion) => getQuiltLoaders(mcVersion));
  ipcMain.handle('accounts:list', () => ({
    accounts: accounts.map(({ accessToken, ...rest }) => ({ ...rest, hasToken: Boolean(accessToken) })),
    currentId: settings.currentAccountId,
  }));
  ipcMain.handle('accounts:add-offline', async (_event, name) => {
    const trimmed = String(name || '').trim().slice(0, 16);
    if (!trimmed) throw new Error('玩家名不能为空');
    const account = { id: `offline-${Date.now().toString(36)}`, type: 'offline', name: trimmed, uuid: offlineUuid(trimmed), accessToken: '0', apiRoot: '', createdAt: Date.now() };
    accounts.push(account);
    settings.currentAccountId = account.id;
    await Promise.all([saveAccounts(), fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2))]);
    send('accounts:update', {});
    return { id: account.id };
  });
  ipcMain.handle('accounts:login', async (_event, { apiRoot, username, password }) => {
    const root = String(apiRoot || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(root)) throw new Error('服务器地址必须以 https:// 开头');
    if (!String(username || '').trim() || !String(password || '')) throw new Error('请输入账号和密码');
    let data;
    try {
      const resp = await fetch(`${root}/authserver/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: { name: 'Minecraft', version: 1 }, username: String(username).trim(), password: String(password) }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.errorMessage || `登录失败 (${resp.status})`);
      data = body;
    } catch (error) {
      if (/登录失败|创建角色|账号/.test(error.message || '')) throw error;
      throw new Error(`无法连接认证服务器：${error.message}`);
    }
    const profile = data.selectedProfile || data.availableProfiles?.[0];
    if (!profile) throw new Error('该账号还没有创建角色，请先到皮肤站网站创建角色');
    const account = { id: `ygg-${Date.now().toString(36)}`, type: 'yggdrasil', apiRoot: root, name: profile.name, uuid: profile.id, accessToken: data.accessToken, createdAt: Date.now() };
    accounts = accounts.filter((a) => !(a.type === 'yggdrasil' && a.apiRoot === root && a.name === account.name));
    accounts.push(account);
    settings.currentAccountId = account.id;
    await Promise.all([saveAccounts(), fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2))]);
    send('accounts:update', {});
    return { id: account.id, name: account.name };
  });
  ipcMain.handle('accounts:select', async (_event, id) => {
    if (!accounts.some((a) => a.id === id)) throw new Error('账户不存在');
    settings.currentAccountId = id;
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    send('accounts:update', {});
    return true;
  });
  ipcMain.handle('accounts:remove', async (_event, id) => {
    accounts = accounts.filter((a) => a.id !== id);
    if (settings.currentAccountId === id) settings.currentAccountId = accounts[0]?.id || null;
    await Promise.all([saveAccounts(), fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2))]);
    send('accounts:update', {});
    return true;
  });
  ipcMain.handle('net:local-ips', () => {
    const result = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      for (const addr of addrs || []) {
        if (addr.family !== 'IPv4' || addr.internal) continue;
        if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(addr.address)) result.push({ name, address: addr.address });
      }
    }
    return result;
  });
  ipcMain.handle('net:cpolar-status', () => ({ downloaded: fs.existsSync(cpolarExePath()), running: Boolean(cpolarChild) }));
  ipcMain.handle('net:download-cpolar', async () => {
    const dir = path.join(DATA_ROOT, 'tools', 'cpolar');
    const exe = cpolarExePath();
    if (fs.existsSync(exe) && fs.statSync(exe).size > 5000000) return { path: exe, skipped: true };
    // 已安装过 cpolar 官方客户端时直接复用
    for (const systemPath of ['C:\\Program Files\\cpolar\\cpolar.exe', 'C:\\Program Files (x86)\\cpolar\\cpolar.exe']) {
      if (fs.existsSync(systemPath) && fs.statSync(systemPath).size > 5000000) {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.copyFile(systemPath, exe);
        return { path: exe, copied: true };
      }
    }
    await fsp.mkdir(dir, { recursive: true });
    const zipPath = path.join(dir, 'cpolar.zip');
    const msiPath = path.join(dir, 'cpolar.msi');
    const extractDir = path.join(dir, 'extract');
    await downloadFile(CPOLAR_ZIP_URLS, zipPath);
    const zip = new AdmZip(zipPath);
    const msiEntry = zip.getEntries().find((entry) => entry.entryName.toLowerCase().endsWith('.msi'));
    if (!msiEntry) throw new Error('cpolar 安装包结构异常');
    zip.extractEntryTo(msiEntry, dir, false, true);
    await fsp.mkdir(extractDir, { recursive: true });
    // msiexec /a 管理解包：只解出文件，不安装系统服务，无需管理员权限
    await new Promise((resolve, reject) => {
      const child = spawn('msiexec', ['/a', msiPath, '/qn', `TARGETDIR=${extractDir}`], { windowsHide: true });
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`解包 cpolar 失败（代码 ${code}）`)));
      child.on('error', reject);
    });
    const extracted = path.join(extractDir, 'cpolar', 'cpolar.exe');
    if (!fs.existsSync(extracted)) throw new Error('解包后未找到 cpolar 程序');
    await fsp.copyFile(extracted, exe);
    await Promise.allSettled([
      fsp.unlink(zipPath), fsp.unlink(msiPath),
      fsp.rm(extractDir, { recursive: true, force: true }),
    ]);
    return { path: exe };
  });
  ipcMain.handle('net:start-cpolar', async (_event, port, token) => {
    if (cpolarChild) return { running: true };
    const exe = cpolarExePath();
    if (!fs.existsSync(exe)) throw new Error('请先下载 cpolar 隧道程序');
    const trimmed = String(token || '').trim() || String(settings.cpolarAuthToken || '').trim();
    if (!trimmed) throw new Error('请先到 cpolar 官网注册并填写 authtoken');
    settings.cpolarAuthToken = trimmed;
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    await fsp.writeFile(cpolarConfigPath(), `authtoken: ${trimmed}\nweb_addr: 127.0.0.1:${CPOLAR_WEB_PORT}\n`, 'utf8');
    const localPort = Math.min(65535, Math.max(1024, parseInt(port, 10) || 25565));
    cpolarChild = spawn(exe, ['tcp', String(localPort), `-config=${cpolarConfigPath()}`, '-log=stdout'], { windowsHide: true });
    cpolarChild.stdout.on('data', (data) => sendCpolarOutput(data.toString()));
    cpolarChild.stderr.on('data', (data) => sendCpolarOutput(data.toString()));
    cpolarChild.on('exit', () => {
      cpolarChild = null;
      send('net:cpolar-log', { text: '—— 隧道已停止 ——' });
    });
    pollCpolarAddress().catch(() => {});
    return { running: true };
  });
  ipcMain.handle('net:stop-cpolar', () => {
    if (cpolarChild) {
      cpolarChild.kill();
      cpolarChild = null;
    }
    return true;
  });
  ipcMain.handle('net:open-cpolar', () => shell.openExternal('https://dashboard.cpolar.com/get-started'));
  ipcMain.handle('modrinth:search', (_event, options) => searchModrinth(options));
  ipcMain.handle('modrinth:versions', (_event, projectId, options) => projectVersions(projectId, options));
  ipcMain.handle('modrinth:download', (_event, resource) => downloadResource(resource));
  ipcMain.handle('instances:select', async (_event, id) => {
    if (!instances.some((item) => item.id === id)) throw new Error('实例不存在');
    settings.selectedInstanceId = id;
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return id;
  });
  ipcMain.handle('instances:delete', async (_event, id) => {
    const instance = instances.find((item) => item.id === id);
    if (!instance) return;
    if (gameProcesses.has(id)) throw new Error('游戏正在运行，无法删除此实例');
    instances = instances.filter((item) => item.id !== id);
    if (settings.selectedInstanceId === id) settings.selectedInstanceId = instances[0]?.id || null;
    await fsp.writeFile(INSTANCES_FILE, JSON.stringify(instances, null, 2));
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    await shell.trashItem(instance.gameDir);
    send('instances:update', { instances, selectedInstanceId: settings.selectedInstanceId });
  });
  ipcMain.handle('game:launch', (_event, id) => launchGame(id));
  ipcMain.handle('folder:open', async (_event, kind, id) => {
    const instance = instances.find((item) => item.id === id);
    let target = kind === 'root' ? DATA_ROOT : settings.gameDirectory;
    if (instance) {
      const sub = { mods: 'mods', shaderpacks: 'shaderpacks', saves: 'saves' }[kind];
      target = sub ? path.join(instance.gameDir, sub) : instance.gameDir;
    }
    await fsp.mkdir(target, { recursive: true });
    return shell.openPath(target);
  });
  ipcMain.handle('dialog:java', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('dialog:directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('java:detect', () => detectJava());
  ipcMain.handle('system:optimize-memory', () => optimizeMemory());
  ipcMain.handle('tasks:cancel', (_event, id) => {
    controllers.get(id)?.abort();
    updateTask(id, { status: 'cancelled', detail: '已取消' });
  });
  ipcMain.handle('tasks:clear', () => {
    for (const [id, task] of tasks) if (['completed', 'error', 'cancelled'].includes(task.status)) tasks.delete(id);
    return [...tasks.values()];
  });
  ipcMain.handle('logs:open-error', async () => {
    await fsp.mkdir(path.dirname(ERROR_LOG_FILE), { recursive: true });
    if (!fs.existsSync(ERROR_LOG_FILE)) await fsp.writeFile(ERROR_LOG_FILE, 'HCL 错误日志\n（此文件记录下载/安装失败详情，按时间追加）\n\n', 'utf8');
    return shell.openPath(ERROR_LOG_FILE);
  });
  ipcMain.handle('app:check-updates', async () => {
    if (!app.isPackaged) return { status: 'dev' };
    if (process.platform !== 'win32') return { status: 'unsupported' };
    try {
      return await checkForUpdatesWithFallback();
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  });
  ipcMain.handle('app:install-update', () => {
    if (!app.isPackaged || process.platform !== 'win32') return { status: 'dev' };
    autoUpdater.quitAndInstall(false, true);
    return { status: 'installing' };
  });
  ipcMain.handle('window:minimize', () => mainWindow.minimize());
  ipcMain.handle('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.handle('window:close', () => mainWindow.close());
}

let updateTaskId = null;
let updateReadyVersion = null;
let updateTimer = null;
let updateRetryAttempts = 0;
let lastUpdateCheckAt = 0;
const UPDATE_CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 正常每 2 小时复查一次
const UPDATE_RETRY_BASE = 60 * 1000;              // 检查失败 1 分钟后重试
const UPDATE_RETRY_MAX = 15 * 60 * 1000;          // 重试间隔上限 15 分钟
const UPDATE_FOCUS_GAP = 10 * 60 * 1000;          // 窗口聚焦检查的最小间隔

function canAutoUpdate() {
  return app.isPackaged && process.platform === 'win32' && settings.autoUpdate !== false;
}

// PCL2 式更新镜像链：官方 GitHub 源连不上时，经国内镜像检查版本并下载更新
const GH_REPO = 'houshibo0101/HCL';
const GH_MIRRORS = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
  'https://ghproxy.net/',
  'https://github.moeyy.xyz/',
  'https://ghproxy.cc/',
  'https://gh.llkk.cc/',
];
const JSDELIVR_SOURCES = [
  'https://cdn.jsdelivr.net/gh/houshibo0101/HCL@main/package.json',
  'https://fastly.jsdelivr.net/gh/houshibo0101/HCL@main/package.json',
];

function isNewerVersion(remote, local) {
  const parse = (v) => String(v).replace(/^v/, '').split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const a = parse(remote);
  const b = parse(local);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// 所有镜像并行竞速，任何一个成功立即返回（避免串行等满 60 秒）
async function findMirrorUpdate() {
  const attempts = GH_MIRRORS.map(async (prefix) => {
    const res = await fetch(`${prefix}https://api.github.com/repos/${GH_REPO}/releases/latest`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = await res.json();
    const tag = String(info.tag_name || '').replace(/^v/, '');
    if (!tag || !isNewerVersion(tag, app.getVersion())) throw new Error('无新版本');
    return { prefix, tag };
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

// jsDelivr CDN（非 GitHub 域名）作为版本元数据备用通道
async function findJsDelivrUpdate() {
  for (const url of JSDELIVR_SOURCES) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const pkg = await res.json();
      const tag = String(pkg.version || '');
      if (tag && isNewerVersion(tag, app.getVersion())) return { tag };
    } catch { /* 下一个源 */ }
  }
  return null;
}

// 找一个能取到 latest.yml 的镜像作为下载通道
async function findWorkingMirrorBase() {
  for (const prefix of GH_MIRRORS) {
    try {
      const res = await fetch(`${prefix}https://github.com/${GH_REPO}/releases/latest/download/latest.yml`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
      if (res.ok) return prefix;
    } catch { /* 下一个 */ }
  }
  return GH_MIRRORS[0];
}

// 自动区分国内外：探测 GitHub 可达性与延迟，决定更新源顺序（5 分钟缓存）
let updateRegion = null;
let updateRegionCheckedAt = 0;
let feedMode = 'official'; // 'official' | 'mirror'

async function detectUpdateRegion() {
  if (updateRegion && Date.now() - updateRegionCheckedAt < 5 * 60 * 1000) return updateRegion;
  const started = Date.now();
  try {
    const res = await fetch('https://api.github.com/zen', { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(2500) });
    updateRegion = res.ok && Date.now() - started < 2500 ? 'overseas' : 'china';
  } catch {
    updateRegion = 'china';
  }
  updateRegionCheckedAt = Date.now();
  return updateRegion;
}

async function checkOfficialFeed() {
  if (feedMode !== 'official') {
    autoUpdater.setFeedURL({ provider: 'github', owner: 'houshibo0101', repo: 'HCL' });
    feedMode = 'official';
  }
  const result = await autoUpdater.checkForUpdates();
  updateRetryAttempts = 0;
  scheduleNextUpdateCheck(UPDATE_CHECK_INTERVAL);
  return { status: result?.isUpdateAvailable ? 'available' : 'none', version: result?.updateInfo?.version || app.getVersion(), via: 'official' };
}

async function checkMirrorFeed() {
  // 版本元数据：镜像 API 并行竞速 → jsDelivr CDN 兜底
  const mirror = await findMirrorUpdate();
  const viaMeta = mirror ? '镜像 API' : 'jsDelivr';
  const tag = (mirror || await findJsDelivrUpdate())?.tag;
  if (!tag) throw new Error('无新版本');
  const base = await findWorkingMirrorBase();
  autoUpdater.setFeedURL({ provider: 'generic', url: `${base}https://github.com/${GH_REPO}/releases/latest/download/` });
  feedMode = 'mirror';
  const result = await autoUpdater.checkForUpdates();
  updateRetryAttempts = 0;
  scheduleNextUpdateCheck(UPDATE_CHECK_INTERVAL);
  return { status: result?.isUpdateAvailable ? 'available' : 'none', version: result?.updateInfo?.version || app.getVersion(), via: 'mirror', viaMeta };
}

async function checkForUpdatesWithFallback() {
  // 在国外（GitHub 直连快）优先官方源；在国内优先镜像；首选失败自动切到另一种
  const region = await detectUpdateRegion();
  const order = region === 'china' ? ['mirror', 'official'] : ['official', 'mirror'];
  let lastError = null;
  for (const mode of order) {
    try {
      return mode === 'official' ? await checkOfficialFeed() : await checkMirrorFeed();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('更新检查失败');
}

function scheduleNextUpdateCheck(delay) {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = null;
  if (!canAutoUpdate()) return;
  updateTimer = setTimeout(() => {
    runAutoUpdateCheck().catch(() => {});
  }, delay);
  updateTimer.unref?.();
}

async function runAutoUpdateCheck() {
  if (!canAutoUpdate()) return;
  if (updateTaskId) { scheduleNextUpdateCheck(UPDATE_CHECK_INTERVAL); return; } // 正在下载，不打断
  if (updateReadyVersion) { scheduleNextUpdateCheck(UPDATE_CHECK_INTERVAL); return; } // 已就绪等重启，无需再查
  lastUpdateCheckAt = Date.now();
  try {
    await checkForUpdatesWithFallback();
    updateRetryAttempts = 0;
    scheduleNextUpdateCheck(UPDATE_CHECK_INTERVAL);
  } catch {
    updateRetryAttempts += 1;
    // 网络不通时 1 分钟起步、逐次拉长（上限 15 分钟）自动重试，不再等 4 小时
    scheduleNextUpdateCheck(Math.min(UPDATE_RETRY_BASE * updateRetryAttempts, UPDATE_RETRY_MAX));
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    send('app:update', { status: 'available', version: info.version });
    updateTaskId = createTask('update', `更新 HCL 至 v${info.version}`);
  });
  autoUpdater.on('update-not-available', (info) => send('app:update', { status: 'none', version: info.version }));
  autoUpdater.on('download-progress', (progress) => {
    if (updateTaskId) updateTask(updateTaskId, {
      progress: progress.percent,
      received: progress.transferred,
      total: progress.total,
      detail: `${(progress.transferred / 1048576).toFixed(1)} MB / ${(progress.total / 1048576).toFixed(1)} MB`,
    });
    send('app:update', { status: 'downloading', percent: progress.percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReadyVersion = info.version;
    if (updateTaskId) {
      finishTask(updateTaskId, 'completed', `v${info.version} 已就绪，重启应用后自动安装`);
      updateTaskId = null;
    }
    send('app:update', { status: 'ready', version: info.version });
  });
  autoUpdater.on('error', (error) => {
    if (updateTaskId) {
      finishTask(updateTaskId, 'error', error.message);
      updateTaskId = null;
    }
    send('app:update', { status: 'error', message: error.message });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 12 } } : {}),
    backgroundColor: THEME_BACKGROUNDS[settings.theme] || THEME_BACKGROUNDS.green,
    icon: path.join(__dirname, isDev ? '../public/hcl.png' : '../dist/hcl.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (process.env.HCL_CAPTURE_PATH) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
      try {
        const image = await mainWindow.webContents.capturePage();
        await fsp.writeFile(process.env.HCL_CAPTURE_PATH, image.toPNG());
      } catch (error) {
        console.error('capture failed:', error);
      } finally {
        app.quit();
      }
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('focus', () => {
    // 用户每次切回窗口都会顺手查一次更新（限流 10 分钟），不依赖固定周期
    if (Date.now() - lastUpdateCheckAt > UPDATE_FOCUS_GAP) runAutoUpdateCheck().catch(() => {});
  });
  // 渲染层错误捕获：界面异常时写入 error.log，便于远程诊断
  const reportRendererIssue = (message) => {
    fsp.mkdir(path.dirname(ERROR_LOG_FILE), { recursive: true })
      .then(() => fsp.appendFile(ERROR_LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] ${message}\n`, 'utf8'))
      .catch(() => {});
  };
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 3) reportRendererIssue(`[渲染层] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    reportRendererIssue(`[渲染进程退出] ${details.reason}`);
  });
  mainWindow.webContents.on('unresponsive', () => {
    reportRendererIssue('[渲染进程无响应]');
  });
}

app.whenReady().then(async () => {
  await ensureStorage();
  registerIpc();
  setupAutoUpdater();
  createWindow();
  if (app.isPackaged && process.platform === 'win32') {
    if (settings.autoUpdate !== false) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {});
      }, 6000);
    }
    scheduleNextUpdateCheck(6000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (cpolarChild) {
    cpolarChild.kill();
    cpolarChild = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

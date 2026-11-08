const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const AdmZip = require('adm-zip');
const { autoUpdater } = require('electron-updater');
const {
  compareBuildDesc, isNewerVersion, legacyLangCode, nativeArchName, nativeClassifierSuffix,
  offlineUuid, parseJavaMajor, pickDownloadMajor, requiredJavaMajorFallback,
} = require('./lib/version-utils.cjs');
const { migrateInstance } = require('./lib/shared-migration.cjs');
const { downloadFile } = require('./lib/downloader.cjs');

const isDev = !app.isPackaged;
const DATA_ROOT = process.env.HCL_DATA_DIR || (process.platform === 'win32' && fs.existsSync('D:\\') ? 'D:\\HCL\\data' : path.join(app.getPath('userData'), 'data'));
const SETTINGS_FILE = path.join(DATA_ROOT, 'settings.json');
const INSTANCES_FILE = path.join(DATA_ROOT, 'instances.json');
const ACCOUNTS_FILE = path.join(DATA_ROOT, 'accounts.json');
const CACHE_DIR = path.join(DATA_ROOT, 'cache');
// 游戏资源全局共享：同一个版本的 assets / libraries 只存一份，实例目录只放自己的东西
const SHARED_DIR = path.join(DATA_ROOT, 'shared');
const SHARED_ASSETS = path.join(SHARED_DIR, 'assets');
const SHARED_LIBRARIES = path.join(SHARED_DIR, 'libraries');
let accounts = [];
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const USER_AGENT = 'HCL/1.0 (Minecraft Launcher)';
let mainWindow;
let settings;
let instances = [];
let bootNotice = null;
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
    await writeJsonAtomic(SETTINGS_FILE, settings);
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
    await writeJsonAtomic(SETTINGS_FILE, settings);
  }
  // 迁移历史明文令牌：读取时加密，写回一次即可，之后每次启动都是幂等的
  const secretUpdates = [];
  for (const account of accounts) {
    const encrypted = encryptSecret(account.accessToken);
    if (encrypted !== account.accessToken) { account.accessToken = encrypted; secretUpdates.push(account.id); }
  }
  if (settings.cpolarAuthToken) {
    const encrypted = encryptSecret(settings.cpolarAuthToken);
    if (encrypted !== settings.cpolarAuthToken) { settings.cpolarAuthToken = encrypted; secretUpdates.push('cpolar'); }
  }
  if (secretUpdates.length) {
    await writeJsonAtomic(ACCOUNTS_FILE, accounts);
    await writeJsonAtomic(SETTINGS_FILE, settings);
  }
  await writeJsonAtomic(ACCOUNTS_FILE, accounts);
  await fsp.mkdir(settings.gameDirectory, { recursive: true });
  await fsp.mkdir(SHARED_ASSETS, { recursive: true });
  await fsp.mkdir(SHARED_LIBRARIES, { recursive: true });
  const migratedInstances = await migrateInstancesToShared();
  if (migratedInstances) {
    bootNotice = `已把 ${migratedInstances} 个旧实例的游戏资源移动到共享目录，相同版本不再重复占空间`;
  }
}

function saveAccounts() {
  return writeJsonAtomic(ACCOUNTS_FILE, accounts);
}

// ---- 2.0.0：老实例内嵌的 assets / libraries 迁移到全局共享目录 ----
async function migrateInstancesToShared() {
  let migrated = 0;
  for (const instance of instances) {
    if (!instance?.gameDir) continue;
    if (await migrateInstance(instance.gameDir, SHARED_ASSETS, SHARED_LIBRARIES)) migrated += 1;
  }
  return migrated;
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

// 原子写入 JSON：先写同目录临时文件再 rename，避免进程中断/并发写入留下半截文件
async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(data, null, 2));
  await fsp.rename(temporary, file);
}

// 敏感字段（Yggdrasil accessToken、cpolar authtoken）用系统密钥加密后再落盘
function encryptSecret(value) {
  const text = String(value || '');
  if (!text || text === '0' || text.startsWith('enc:')) return text;
  try {
    if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(text).toString('base64')}`;
  } catch { /* 系统密钥不可用时退回明文，保证功能可用 */ }
  return text;
}

function decryptSecret(value) {
  const text = String(value || '');
  if (!text.startsWith('enc:')) return text;
  try {
    return safeStorage.decryptString(Buffer.from(text.slice(4), 'base64'));
  } catch {
    return '';
  }
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
        signal: options.signal || AbortSignal.timeout(options.timeout || 30000),
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

function mirrorLibUrl(url) {
  // BMCLAPI 对 Fabric Maven 与 Mojang libraries 的镜像
  return String(url || '')
    .replace('https://maven.fabricmc.net', 'https://bmclapi2.bangbang93.com/maven')
    .replace('https://libraries.minecraft.net', 'https://bmclapi2.bangbang93.com/maven')
    .replace('https://meta.fabricmc.net', 'https://bmclapi2.bangbang93.com/fabric-meta');
}

// 下载实现见 electron/lib/downloader.cjs（断点续传 + SHA1 校验 + 失败重试）
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
  const skipped = [];
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
          sha1: item.sha1,
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
        if (error.name === 'AbortError') return;
        // 可选文件（游戏资源）坏一个不该让整个安装失败：记下来继续
        if (item.optional) {
          skipped.push({ item, error });
          progressByFile.set(index, item.size || 0);
          completed++;
          continue;
        }
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
  return { total: items.length, completed, skipped };
}

function currentOs() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

// Mojang 清单里的 os.arch 只有 x86 / x64 / arm64 三种取值
const NATIVE_ARCH = nativeArchName(process.arch);

function rulesAllow(rules = [], features = {}) {
  if (!rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== currentOs()) matches = false;
      if (rule.os.arch && rule.os.arch !== NATIVE_ARCH) matches = false;
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
  return nativeClassifierSuffix(process.arch);
}

function libraryFiles(library, librariesRoot = SHARED_LIBRARIES) {
  if (!rulesAllow(library.rules)) return [];
  const base = librariesRoot;
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
        signal: options.signal || AbortSignal.timeout(options.timeout || 30000),
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

async function getForgeBuilds(mcVersion) {
  const prefix = `${mcVersion}-`;
  // 国内镜像优先（BMCLAPI 实测亚秒级），官方源做兜底
  try {
    const data = await fetchJson(`https://bmclapi2.bangbang93.com/forge/minecraft/${encodeURIComponent(mcVersion)}`);
    if (!Array.isArray(data) || !data.length) throw new Error(`Forge 暂不支持 Minecraft ${mcVersion}`);
    const builds = data
      .map((item) => ({ id: `${item.mcversion}-${item.version}`, build: String(item.version) }))
      .filter((item) => item.id.startsWith(prefix))
      .sort((a, b) => compareBuildDesc(a.build, b.build));
    if (!builds.length) throw new Error(`Forge 暂不支持 Minecraft ${mcVersion}`);
    // 推荐版本也从镜像拿（BMCLAPI maven 路径代理官方 promotions）
    let recommended = null;
    let latest = null;
    try {
      const promos = await fetchJson('https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/promotions_slim.json');
      recommended = promos.promos?.[`${mcVersion}-recommended`] || null;
      latest = promos.promos?.[`${mcVersion}-latest`] || recommended;
    } catch {}
    return { builds, recommended, latest };
  } catch (mirrorError) {
    // 官方源兜底（海外网络或镜像异常时）；8 秒快速超时避免干等
    try {
      const xml = await fetchText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml', { timeout: 8000 });
      const builds = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map((m) => m[1])
        .filter((id) => id.startsWith(prefix))
        .map((id) => ({ id, build: id.slice(prefix.length) }))
        .sort((a, b) => compareBuildDesc(a.build, b.build));
      if (!builds.length) throw new Error(`Forge 暂不支持 Minecraft ${mcVersion}`);
      let recommended = null;
      let latest = null;
      try {
        const promos = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { timeout: 8000 });
        recommended = promos.promos?.[`${mcVersion}-recommended`] || null;
        latest = promos.promos?.[`${mcVersion}-latest`] || recommended;
      } catch {}
      return { builds, recommended, latest };
    } catch {
      throw mirrorError;
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
      // 规范化 Forge 版本 id：recommended/latest 默认值是纯版本号（65.1.5），
      // builds 列表里的 id 带版本前缀（26.2-65.1.5）；installer URL 需要完整 id
      forgeId = String(forgeId).startsWith(`${version.id}-`) ? String(forgeId) : `${version.id}-${forgeId}`;
      runtimeVersion = `${version.id}-forge-${forgeId.slice(version.id.length + 1)}`;
    } else {
      meta = await resolveVersion(entry.url);
      runtimeVersion = meta.id || version.id;
    }
    const id = `${runtimeVersion.replace(/[^a-zA-Z0-9._-]/g, '-')}-${Date.now().toString(36)}`;
    const gameDir = path.join(settings.gameDirectory, 'instances', id);
    attemptDir = gameDir;
    let versionDir = path.join(gameDir, 'versions', runtimeVersion);
    await fsp.mkdir(versionDir, { recursive: true });
    updateTask(taskId, { detail: '读取版本信息…', progress: 1 });
    const isInstallerLoader = loader === 'Forge' || loader === 'NeoForge';
    if (!isInstallerLoader) {
      await fsp.writeFile(path.join(versionDir, `${runtimeVersion}.json`), JSON.stringify(meta, null, 2));
    }
    const assetMeta = isInstallerLoader ? vanillaMeta : meta;
    const assetIndexUrl = assetMeta?.assetIndex?.url;
    if (!assetIndexUrl) throw new Error('此版本缺少资源索引');
    const assetIndexPath = path.join(SHARED_ASSETS, 'indexes', `${assetMeta.assetIndex.id}.json`);
    await downloadFile(assetIndexUrl, assetIndexPath, { signal: controllers.get(taskId)?.signal, expectedSize: assetMeta.assetIndex.size, sha1: assetMeta.assetIndex.sha1 });
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
        for (const file of libraryFiles(library)) {
          const libUrls = [...new Set([file.url, mirrorLibUrl(file.url)].filter(Boolean))];
          if (pushDownload({ ...file, url: file.url, urls: libUrls, label: path.basename(file.destination) }) && file.native) {
            nativeLibraries.push(file.destination);
          }
        }
      }
      if (meta.logging?.client?.file) {
        const logFile = meta.logging.client.file;
        pushDownload({ ...logFile, destination: path.join(SHARED_ASSETS, 'log_configs', logFile.id), label: '日志配置' });
      }
    }
    for (const [assetPath, object] of Object.entries(assetIndex.objects || {})) {
      const objectHash = object.hash;
      const prefix = objectHash.slice(0, 2);
      pushDownload({
        // 官方源 + BMCLAPI 资源镜像，任一可用即可
        urls: [
          `https://resources.download.minecraft.net/${prefix}/${objectHash}`,
          `https://bmclapi2.bangbang93.com/assets/${prefix}/${objectHash}`,
        ],
        size: object.size,
        sha1: objectHash,
        destination: path.join(SHARED_ASSETS, 'objects', prefix, objectHash),
        label: `游戏资源 ${assetPath.split('/').pop() || objectHash.slice(0, 8)}`,
        // 语言/音效这类资源坏个别文件不该让整个安装失败
        optional: true,
      });
    }
    const queueResult = await downloadQueue(downloads, taskId, 8);
    if (queueResult?.skipped?.length) {
      await appendErrorLog({
        title: `安装 Minecraft ${version.id}${loader !== 'Vanilla' ? ` · ${loader}` : ''}（部分资源跳过）`,
        error: new Error(`${queueResult.skipped.length} 个资源文件校验失败已跳过`),
        extra: queueResult.skipped.slice(0, 5).reduce((acc, entry, i) => {
          acc[`文件${i + 1}`] = `${path.basename(entry.item.destination)} · ${entry.error.message}`;
          return acc;
        }, {}),
      });
    }
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
      writeJsonAtomic(INSTANCES_FILE, instances),
      writeJsonAtomic(SETTINGS_FILE, settings),
    ]);
    const skippedNote = queueResult?.skipped?.length ? `，${queueResult.skipped.length} 个资源已跳过` : '';
    finishTask(taskId, 'completed', (finishDetail || `安装完成 · ${downloads.length} 个文件`) + skippedNote);
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
  const nativesMarker = path.join(nativesDir, '.hcl-natives.json');
  const classpath = [];
  const nativeFiles = [];
  for (const library of meta.libraries || []) {
    for (const file of libraryFiles(library)) {
      if (file.native) nativeFiles.push(file);
      else classpath.push(file.destination);
    }
  }
  // 原生库解压结果缓存：清单没变就不重复解压（每次启动能省 1–2 秒）
  const nativesSignature = nativeFiles.map((file) => `${path.basename(file.destination)}:${file.size || 0}`).sort().join('|');
  let cachedSignature = null;
  try { cachedSignature = JSON.parse(await fsp.readFile(nativesMarker, 'utf8'))?.signature || null; } catch {}
  if (!nativeFiles.length || cachedSignature === nativesSignature) {
    await fsp.mkdir(nativesDir, { recursive: true });
  } else {
    await fsp.rm(nativesDir, { recursive: true, force: true });
    await fsp.mkdir(nativesDir, { recursive: true });
    for (const file of nativeFiles) {
      const zip = new AdmZip(file.destination);
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory && !entry.entryName.startsWith('META-INF/')) zip.extractEntryTo(entry, nativesDir, false, true);
      }
    }
    await writeJsonAtomic(nativesMarker, { signature: nativesSignature });
  }
  const clientJar = path.join(instance.versionDir, `${runtimeVersion}.jar`);
  classpath.push(clientJar);
  const account = accounts.find((a) => a.id === settings.currentAccountId) || accounts[0] || null;
  const username = (account?.name || settings.username || 'Player').trim() || 'Player';
  const authUuid = account?.type === 'yggdrasil' && account.uuid ? account.uuid : offlineUuid(username);
  const authToken = account?.type === 'yggdrasil' && account.accessToken ? decryptSecret(account.accessToken) : '0';
  const values = {
    auth_player_name: username,
    version_name: instance.version,
    game_directory: gameDir,
    assets_root: SHARED_ASSETS,
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
    library_directory: SHARED_LIBRARIES,
    game_assets: SHARED_ASSETS,
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
  await writeJsonAtomic(INSTANCES_FILE, instances);
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
      sha1: file.hashes?.sha1 || '',
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
  return file ? { url: file.url, filename: file.filename, size: file.size || 0, sha1: file.hashes?.sha1 || '', version: release.version_number } : null;
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
        sha1: file.sha1,
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
    await writeJsonAtomic(SETTINGS_FILE, settings);
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
    await Promise.all([saveAccounts(), writeJsonAtomic(SETTINGS_FILE, settings)]);
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
    const account = { id: `ygg-${Date.now().toString(36)}`, type: 'yggdrasil', apiRoot: root, name: profile.name, uuid: profile.id, accessToken: encryptSecret(data.accessToken), createdAt: Date.now() };
    accounts = accounts.filter((a) => !(a.type === 'yggdrasil' && a.apiRoot === root && a.name === account.name));
    accounts.push(account);
    settings.currentAccountId = account.id;
    await Promise.all([saveAccounts(), writeJsonAtomic(SETTINGS_FILE, settings)]);
    send('accounts:update', {});
    return { id: account.id, name: account.name };
  });
  ipcMain.handle('accounts:select', async (_event, id) => {
    if (!accounts.some((a) => a.id === id)) throw new Error('账户不存在');
    settings.currentAccountId = id;
    await writeJsonAtomic(SETTINGS_FILE, settings);
    send('accounts:update', {});
    return true;
  });
  ipcMain.handle('accounts:remove', async (_event, id) => {
    accounts = accounts.filter((a) => a.id !== id);
    if (settings.currentAccountId === id) settings.currentAccountId = accounts[0]?.id || null;
    await Promise.all([saveAccounts(), writeJsonAtomic(SETTINGS_FILE, settings)]);
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
    const trimmed = String(token || '').trim() || decryptSecret(settings.cpolarAuthToken).trim();
    if (!trimmed) throw new Error('请先到 cpolar 官网注册并填写 authtoken');
    settings.cpolarAuthToken = encryptSecret(trimmed);
    await writeJsonAtomic(SETTINGS_FILE, settings);
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
  ipcMain.handle('net:open-cpolar', () => openExternalSafe('https://dashboard.cpolar.com/get-started'));
  ipcMain.handle('modrinth:search', (_event, options) => searchModrinth(options));
  ipcMain.handle('modrinth:versions', (_event, projectId, options) => projectVersions(projectId, options));
  ipcMain.handle('modrinth:download', (_event, resource) => downloadResource(resource));
  ipcMain.handle('instances:select', async (_event, id) => {
    if (!instances.some((item) => item.id === id)) throw new Error('实例不存在');
    settings.selectedInstanceId = id;
    await writeJsonAtomic(SETTINGS_FILE, settings);
    return id;
  });
  ipcMain.handle('instances:delete', async (_event, id) => {
    const instance = instances.find((item) => item.id === id);
    if (!instance) return;
    if (gameProcesses.has(id)) throw new Error('游戏正在运行，无法删除此实例');
    instances = instances.filter((item) => item.id !== id);
    if (settings.selectedInstanceId === id) settings.selectedInstanceId = instances[0]?.id || null;
    await writeJsonAtomic(INSTANCES_FILE, instances);
    await writeJsonAtomic(SETTINGS_FILE, settings);
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
    // 网络不通时 1 分钟起步、逐次拉长（上限 15 分钟）自动重试，不再等 2 小时
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

// 只放行 http(s) 外链：链接数据来自第三方 API，避免 file:// 等协议被 openExternal 执行
function openExternalSafe(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return shell.openExternal(parsed.toString());
  } catch { /* 非法 URL 直接忽略 */ }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // 2.1：默认窗口收小到 1180×760，不再一打开就逼近全屏；布局按此尺寸重新适配
    width: 1180,
    height: 760,
    minWidth: 1024,
    minHeight: 660,
    center: true,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 12 } } : {}),
    backgroundColor: THEME_BACKGROUNDS[settings.theme] || THEME_BACKGROUNDS.green,
    icon: path.join(__dirname, isDev ? '../public/hcl.png' : '../dist/hcl.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // 启动期的一次性提示（例如旧实例资源迁移完成）
  mainWindow.webContents.on('did-finish-load', () => {
    if (!bootNotice) return;
    send('app:toast', { message: bootNotice, type: 'info' });
    bootNotice = null;
  });
  if (process.env.HCL_CAPTURE_PATH) {
    // 仅用于开发/截图对比：HCL_CAPTURE_PAGE 可先切到指定页面再截图，HCL_CAPTURE_CSS 可注入一份候选皮肤
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        if (process.env.HCL_CAPTURE_SIZE) {
          const [w, h] = String(process.env.HCL_CAPTURE_SIZE).split('x').map(Number);
          if (w > 0 && h > 0) {
            mainWindow.setContentSize(w, h);
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
        if (process.env.HCL_CAPTURE_CSS) {
          const skin = await fsp.readFile(process.env.HCL_CAPTURE_CSS, 'utf8');
          await mainWindow.webContents.executeJavaScript(`(() => {
            const style = document.createElement('style');
            style.dataset.hclSkin = 'capture';
            style.textContent = ${JSON.stringify(skin)};
            document.head.appendChild(style);
            return style.textContent.length;
          })()`);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        const page = process.env.HCL_CAPTURE_PAGE;
        if (page) {
          const label = JSON.stringify(String(page));
          await mainWindow.webContents.executeJavaScript(`(() => {
            const buttons = [...document.querySelectorAll('.main-nav button, .settings-nav')];
            const target = buttons.find((b) => b.textContent.trim() === ${label});
            if (target) target.click();
            return Boolean(target);
          })()`);
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }
        // 把鼠标移开，避免 hover 态影响截图对比
        mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4 });
        await new Promise((resolve) => setTimeout(resolve, 200));
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
    openExternalSafe(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 允许 Vite 开发服务器自身的导航，其余一律拦下改用系统浏览器打开
    if (isDev && String(url).startsWith('http://127.0.0.1:5173')) return;
    event.preventDefault();
    openExternalSafe(url);
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

async function boot() {
  await ensureStorage();
  registerIpc();
  setupAutoUpdater();
  createWindow();
  // 启动 6 秒后做第一次自动检查：交给统一调度器，避免与手动检查重复触发
  scheduleNextUpdateCheck(6000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// 单实例锁：两个进程同时写 settings.json / instances.json 会互相覆盖
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(boot);
}

app.on('before-quit', () => {
  if (cpolarChild) {
    cpolarChild.kill();
    cpolarChild = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

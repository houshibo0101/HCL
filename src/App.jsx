import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Download, Gamepad2, Info, LoaderCircle, Minus, RefreshCw,
  Settings, Square, X, XCircle, Rocket,
} from 'lucide-react';
import { Modal, Logo } from './components/chrome';
import { NAV_ITEMS, PAGE_META } from './constants';
import { setAllTasks, upsertTask, useTasks } from './lib/task-store';
import { HomePage } from './pages/HomePage';
import { VersionsPage } from './pages/VersionsPage';
import { ResourceBrowser } from './pages/ResourcesPage';
import { NetworkPage } from './pages/NetworkPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { SettingsPage } from './pages/SettingsPage';
import { InstanceModal } from './components/InstanceModal';

// 侧栏下载角标单独订阅任务状态，避免任务进度把整个 App 一起重渲染
function DownloadsBadge() {
  const active = useTasks().filter((task) => task.status === 'downloading').length;
  if (!active) return null;
  return <b>{active}</b>;
}

export default function App() {
  const [page, setPage] = useState('home');
  const [state, setState] = useState({ settings: { username: 'Player', memory: 4096 }, instances: [], dataRoot: 'D:\\HCL\\data', appVersion: '', platform: 'win32' });
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [instanceModal, setInstanceModal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [running, setRunning] = useState([]);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const [updatePanel, setUpdatePanel] = useState(false);
  const [checking, setChecking] = useState(false);
  const [splash, setSplash] = useState('in'); // in → out → gone（PCL2 式启动画面）
  const bootAt = useRef(Date.now());
  useEffect(() => {
    if (!ready) return;
    if (splash === 'in') {
      // 至少展示 1 秒，让弹入+悬浮动画完整呈现
      const wait = Math.max(0, 1000 - (Date.now() - bootAt.current));
      const t = setTimeout(() => setSplash('out'), wait);
      return () => clearTimeout(t);
    }
    if (splash === 'out') {
      const t = setTimeout(() => setSplash('gone'), 430);
      return () => clearTimeout(t);
    }
  }, [ready, splash]);
  const [java, setJava] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [currentAccountId, setCurrentAccountId] = useState(null);
  const refreshAccounts = useCallback(() => {
    window.hcl.listAccounts().then((data) => { setAccounts(data.accounts); setCurrentAccountId(data.currentId); }).catch(() => {});
  }, []);
  const toast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((old) => [...old, { id, message, type }]);
    setTimeout(() => setToasts((old) => old.filter((item) => item.id !== id)), 4200);
  }, []);
  useEffect(() => {
    window.hcl.getState()
      .then((data) => {
        const { tasks, ...rest } = data;
        setState(rest);
        setAllTasks(tasks);
        setRunning(data.running || []);
        setReady(true); // 先放行界面，再在后台检测 Java，避免 splash 被 Java 扫描拖住
        window.hcl.detectJava().then(setJava).catch(() => {});
      })
      // 初始化失败也要放行 splash，否则用户会永远停在启动画面
      .catch((e) => toast(e.message || '启动器初始化失败', 'error'))
      .finally(() => setReady(true));
    refreshAccounts();
    const offAccounts = window.hcl.listen('accounts:update', refreshAccounts);
    const offTask = window.hcl.onTask(upsertTask);
    const offInstances = window.hcl.onInstances((data) => setState((old) => ({ ...old, instances: data.instances, settings: { ...old.settings, selectedInstanceId: data.selectedInstanceId } })));
    const offLog = window.hcl.onGameLog((data) => {
      if (data.exited) { setRunning((old) => old.filter((id) => id !== data.instanceId)); toast('游戏进程已退出', 'info'); }
    });
    const offUpdate = window.hcl.listen('app:update', (data) => {
      if (!data) return;
      setUpdateInfo((old) => {
        // 已就绪状态不被后续的「无更新」事件覆盖
        if (data.status === 'none' && old?.status === 'ready') return old;
        return { ...old, ...data };
      });
      if (data.status === 'ready') { setUpdateBannerDismissed(false); toast(`HCL v${data.version} 已下载完成，可立即重启安装`, 'info'); }
      else if (data.status === 'available') toast(`发现新版本 v${data.version}，正在后台下载…`, 'info');
    });
    const offToast = window.hcl.listen('app:toast', (d) => d?.message && toast(d.message, d.type || 'info'));
    return () => { offTask(); offInstances(); offLog(); offUpdate(); offAccounts(); offToast(); };
  }, [toast, refreshAccounts]);
  const prevThemeRef = useRef(null);
  useEffect(() => {
    const next = state.settings.theme || 'green';
    const prev = prevThemeRef.current;
    prevThemeRef.current = next;
    document.documentElement.dataset.theme = next;
    if (prev === null || prev === next) return;
    // PCL2 式平滑换装：切换后 360ms 内启用全局颜色过渡（纯 CSS，绝不阻塞交互）
    const root = document.documentElement;
    root.classList.add('theme-morphing');
    const timer = setTimeout(() => root.classList.remove('theme-morphing'), 360);
    return () => { clearTimeout(timer); root.classList.remove('theme-morphing'); };
  }, [state.settings.theme]);
  const selected = state.instances.find((item) => item.id === state.settings.selectedInstanceId) || state.instances[0];
  const currentAccount = accounts.find((item) => item.id === currentAccountId) || accounts[0] || null;
  const navigate = (next) => setPage(next);
  const selectInstance = async (id) => {
    await window.hcl.selectInstance(id);
    setState((old) => ({ ...old, settings: { ...old.settings, selectedInstanceId: id } }));
  };
  const install = async (version, name, loader = 'Vanilla', forgeId = null, shaderLoader = null) => {
    setInstalling(true);
    try {
      const result = await window.hcl.installVersion(version, name, loader, forgeId, shaderLoader);
      setState((old) => ({ ...old, instances: [result.instance, ...old.instances], settings: { ...old.settings, selectedInstanceId: result.instance.id } }));
      toast(`Minecraft ${version.id} 安装完成`);
      return result;
    } catch (e) { toast(`${e.message || '安装失败'}（失败日志已生成，可在下载管理打开）`, 'error'); throw e; }
    finally { setInstalling(false); }
  };
  const downloadResource = async (resource) => {
    try { await window.hcl.downloadResource(resource); toast(`${resource.projectTitle} 下载完成`); }
    catch (e) { toast(`${e.message || '下载失败'}（失败日志已生成，可在下载管理打开）`, 'error'); throw e; }
  };
  const launch = async (id) => {
    setLaunching(true);
    try {
      await window.hcl.launchInstance(id);
      setRunning((old) => [...new Set([...old, id])]);
      toast('游戏已启动，祝你玩得开心');
    } catch (e) {
      toast(e.message || '启动失败', 'error');
      if (e.message?.includes('Java')) navigate('settings');
    } finally { setLaunching(false); }
  };
  const checkUpdates = async (openPanel = false) => {
    if (openPanel) setUpdatePanel(true);
    setChecking(true);
    try {
      const result = await window.hcl.checkForUpdates();
      if (result?.via) setUpdateInfo((old) => ({ ...old, via: result.via }));
      if (!openPanel) {
        if (result?.status === 'none') toast('当前已是最新版本');
        else if (result?.status === 'dev') toast('开发模式下暂不支持应用内更新', 'info');
        else if (result?.status === 'unsupported') toast('当前平台暂不支持应用内更新，请从 GitHub Releases 下载新版本', 'info');
        else if (result?.status === 'available') toast(`发现新版本 v${result.version}，正在后台下载`);
        else if (result?.status === 'error') toast(`检查更新失败：${result.message}`, 'error');
      }
    } catch (e) { if (!openPanel) toast(e.message || '检查更新失败', 'error'); }
    finally { setChecking(false); }
  };
  const saveSettings = async (form) => {
    const settings = await window.hcl.saveSettings(form);
    setState((old) => ({ ...old, settings }));
    setJava(await window.hcl.detectJava());
    toast('设置已保存');
  };
  const deleteInstance = async (id) => {
    try { await window.hcl.deleteInstance(id); toast('实例已移入回收站', 'info'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const isMac = state.platform === 'darwin';
  const updateStatus = updateInfo?.status;
  if (splash !== 'gone') return <div className={`app-splash ${splash === 'out' ? 'out' : ''}`}>
    <div className="app-splash-stage"><div className="app-splash-glow" /><img src="hcl.png" alt="HCL" className="app-splash-img" /></div>
    <strong>HCL</strong>
    <div className="app-splash-bar"><i /></div>
    <span>正在准备你的世界…</span>
  </div>;
  return <div className={`app-shell ${isMac ? 'platform-mac' : ''}`}>
    <header className="titlebar"><div className="titlebar-brand"><Logo compact /></div><div className="window-title"><span>HCL</span><i />{PAGE_META[page][0]}</div>{!isMac && <div className="window-controls"><button onClick={() => window.hcl.windowMinimize()}><Minus size={16} /></button><button onClick={() => window.hcl.windowMaximize()}><Square size={13} /></button><button className="window-close" onClick={() => window.hcl.windowClose()}><X size={17} /></button></div>}</header>
    <aside className="sidebar"><div className="sidebar-brand"><Logo /></div><nav className="main-nav"><span className="nav-label">启动器</span>{NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19} /><span>{label}</span>{id === 'downloads' && <DownloadsBadge />}{page === id && <i />}</button>)}</nav><div className="sidebar-bottom"><button className={`settings-nav ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={19} /><span>设置</span></button><button className="sidebar-player" onClick={() => navigate('settings')}><div className="mini-avatar">{state.settings.username.slice(0, 1).toUpperCase()}<i /></div><div><strong>{state.settings.username}</strong><span>离线模式</span></div><ChevronRight size={15} /></button>{updateInfo?.status === 'ready'
        ? <div className="sidebar-version ready" title="重启后自动完成安装" onClick={() => window.hcl.installUpdate()}>v{updateInfo.version} 已就绪 <span>•</span> 点击重启安装</div>
        : updateInfo?.status === 'downloading'
          ? <div className="sidebar-version" title="新版本正在后台下载">正在下载更新 {Math.floor(updateInfo.percent || 0)}%</div>
          : updateInfo?.status === 'error'
            ? <div className="sidebar-version error" title="点击重试检查更新" onClick={checkUpdates}>更新检查失败 <span>•</span> 点击重试</div>
            : <div className="sidebar-version" title="点击检查启动器更新" onClick={() => checkUpdates(true)}>HCL v{state.appVersion || '—'} <span>•</span> 点击检查更新</div>}</div></aside>
    <main className="main-area"><div className="page-header"><div><h1>{PAGE_META[page][0]}</h1><p>{PAGE_META[page][1]}</p></div>{page === 'home' && <button className="current-instance" onClick={() => setInstanceModal(true)}><div className="current-instance-icon"><Gamepad2 size={18} /></div><div><span>当前实例</span><strong>{selected?.name || '尚未安装游戏'}</strong></div><ChevronDown size={16} /></button>}</div><div className="page-scroll">
      {page === 'home' && <HomePage instances={state.instances} selected={selected} settings={state.settings} onLaunch={launch} launching={launching} running={selected && running.includes(selected.id)} onNavigate={navigate} onManage={() => setInstanceModal(true)} onSelect={selectInstance} onOpenFolder={() => window.hcl.openFolder('games')} java={java} appVersion={state.appVersion} onCheckUpdates={() => checkUpdates(true)} platform={state.platform} account={currentAccount} />}
      {page === 'versions' && <VersionsPage installed={state.instances} onInstall={install} installing={installing} settings={state.settings} />}
      {(page === 'mods' || page === 'shaders') && <ResourceBrowser key={page} kind={page === 'mods' ? 'mod' : 'shader'} instances={state.instances} selected={selected} onDownload={downloadResource} onRequireInstance={() => selected ? setInstanceModal(true) : navigate('versions')} />}
      {page === 'downloads' && <DownloadsPage onCancel={window.hcl.cancelTask} onOpenLog={() => window.hcl.openErrorLog()} onInstallUpdate={() => window.hcl.installUpdate()} onClear={async () => { setAllTasks(await window.hcl.clearTasks()); }} />}
      {page === 'network' && <NetworkPage toast={toast} settings={state.settings} />}
      {page === 'settings' && <SettingsPage settings={state.settings} dataRoot={state.dataRoot} appVersion={state.appVersion} platform={state.platform} onCheckUpdates={() => checkUpdates(true)} onSave={saveSettings} onChooseJava={window.hcl.chooseJava} onChooseDirectory={window.hcl.chooseGameDirectory} onDetectJava={window.hcl.detectJava} java={java} setJava={setJava} onOpenRoot={() => window.hcl.openFolder('root')} toast={toast} accounts={accounts} currentAccountId={currentAccountId} refreshAccounts={refreshAccounts} />}
    </div></main>
    {instanceModal && <InstanceModal instances={state.instances} selectedId={selected?.id} onClose={() => setInstanceModal(false)} onSelect={selectInstance} onDelete={deleteInstance} onOpenFolder={(kind, id) => window.hcl.openFolder(kind, id)} onNew={() => navigate('versions')} />}
    {updatePanel && <Modal title="启动器更新" subtitle="自动检查 · 后台下载 · 一键安装" onClose={() => setUpdatePanel(false)}>
      <div className="update-panel">
        <div className="update-versions">
          <div><span>当前版本</span><strong>v{state.appVersion || '—'}</strong></div>
          <i>→</i>
          <div className={updateStatus === 'none' ? 'latest' : ''}><span>最新版本</span><strong>{updateStatus === 'none' ? `v${state.appVersion}` : updateInfo?.version ? `v${updateInfo.version}` : checking ? '检查中…' : '待检查'}</strong></div>
        </div>
        {updateStatus === 'none' && <div className="update-panel-note ok"><CheckCircle2 size={15} />已是最新版本，无需更新</div>}
        {updateStatus === 'error' && <div className="update-panel-note err"><XCircle size={15} />检查失败：{updateInfo.message || '网络异常'}（已尝试直连 GitHub 与多个国内镜像）<span>可稍后重试，或从 Releases 页手动下载</span></div>}
        {updateStatus === 'dev' && <div className="update-panel-note err"><Info size={15} />开发模式下暂不支持应用内更新</div>}
        {updateStatus === 'unsupported' && <div className="update-panel-note err"><Info size={15} />当前平台暂不支持应用内更新，请从 GitHub Releases 手动下载</div>}
        {(checking || updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready') && <ol className="update-steps">
          <li className={checking && !updateStatus ? 'running' : 'done'}>
            <span className="step-icon">{checking && !updateStatus ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={16} />}</span>
            <div className="step-body"><strong>检查更新</strong><span className="step-desc">{updateInfo?.via === 'mirror' ? '已自动切换国内镜像加速' : '直连 GitHub（国内自动切换镜像）'}</span></div>
            <span className="step-state">{checking && !updateStatus ? '正在连接…' : '完成'}</span>
          </li>
          <li className={updateStatus === 'ready' ? 'done' : (updateStatus === 'available' || updateStatus === 'downloading') ? 'running' : ''}>
            <span className="step-icon"><Download size={15} /></span>
            <div className="step-body">
              <strong>下载新版本</strong><span className="step-desc">后台静默下载，SHA512 校验保证完整</span>
              {(updateStatus === 'available' || updateStatus === 'downloading') && <div className="progress-track"><i className="downloading" style={{ width: `${Math.max(4, Math.floor(updateInfo?.percent || 0))}%` }} /></div>}
            </div>
            <span className="step-state">{updateStatus === 'ready' ? '完成' : (updateStatus === 'available' || updateStatus === 'downloading') ? `${Math.floor(updateInfo?.percent || 0)}%` : '等待'}</span>
          </li>
          <li className={updateStatus === 'ready' ? 'running' : ''}>
            <span className="step-icon"><Rocket size={15} /></span>
            <div className="step-body"><strong>重启安装</strong><span className="step-desc">重启启动器即自动完成安装，几秒钟</span></div>
            {updateStatus === 'ready' && <button className="button primary small" onClick={() => window.hcl.installUpdate()}><Rocket size={13} />立即重启</button>}
          </li>
        </ol>}
        <div className="update-panel-actions">
          <button className="button ghost small" onClick={() => setUpdatePanel(false)}>关闭</button>
          {updateStatus === 'error' && <button className="button secondary small" onClick={() => checkUpdates(true)}><RefreshCw size={13} />重试</button>}
        </div>
      </div>
    </Modal>}
    {updateInfo?.status === 'ready' && !updateBannerDismissed && <div className="update-banner">
      <div className="update-banner-icon"><Rocket size={20} /></div>
      <div className="update-banner-body"><strong>HCL v{updateInfo.version} 已就绪</strong><span>重启启动器即可完成安装，只需几秒钟</span></div>
      <button className="button primary small" onClick={() => window.hcl.installUpdate()}>立即重启</button>
      <button className="button ghost small" onClick={() => setUpdateBannerDismissed(true)}>稍后</button>
    </div>}
    <div className="toast-stack">{toasts.map((item) => <div className={`toast ${item.type}`} key={item.id}>{item.type === 'error' ? <AlertCircle size={18} /> : item.type === 'info' ? <Info size={18} /> : <CheckCircle2 size={18} />}<span>{item.message}</span><button onClick={() => setToasts((old) => old.filter((t) => t.id !== item.id))}><X size={14} /></button></div>)}</div>
  </div>;
}

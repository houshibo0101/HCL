import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowRight, Blocks, Box, CalendarDays, Check, CheckCircle2, Coffee,
  ChevronDown, ChevronRight, Clock3, Download, ExternalLink, FolderOpen,
  Gamepad2, HardDrive, Home, Info, Layers3, Leaf, LoaderCircle, MemoryStick,
  Minus, Package, Pickaxe, Play, Plus, RefreshCw, Search, Settings, ShieldCheck,
  Sparkles, Square,   Trash2, UserRound, X, XCircle, Zap, FileText, Languages, Palette, Network, Users, Globe, Terminal, Copy, LogIn, Rocket,
} from 'lucide-react';
import { translateQuery, lookupProject } from './modDictionary';

let vtRunning = false;
/* View Transitions 已移除（v1.6.6/1.6.7 曾导致界面卡死）：页面切换回退为即时渲染 + CSS 入场动画 */

const THEMES = [
  { id: 'green', name: '翡翠绿', c1: '#83df90', c2: '#50b967' },
  { id: 'blue', name: '穹际蓝', c1: '#8ccbf7', c2: '#3d82d6' },
  { id: 'purple', name: '星辉紫', c1: '#c39bfa', c2: '#7e4fd6' },
  { id: 'orange', name: '暖阳橙', c1: '#f6bd7d', c2: '#e0762d' },
  { id: 'pink', name: '樱花粉', c1: '#fa92bd', c2: '#d64f86' },
  { id: 'teal', name: '薄荷青', c1: '#7fe8d9', c2: '#33a392' },
];

const NAV_ITEMS = [
  { id: 'home', label: '首页', icon: Home },  { id: 'versions', label: '游戏版本', icon: Box },
  { id: 'mods', label: 'Mod 下载', icon: Package },
  { id: 'shaders', label: '光影下载', icon: Sparkles },
  { id: 'network', label: '联机', icon: Network },
  { id: 'downloads', label: '下载管理', icon: Download },
];
const PAGE_META = {
  home: ['概览', '欢迎回到方块世界'], versions: ['游戏版本', '下载并创建新的游戏实例'],
  mods: ['Mod 下载', '发现社区创作的无限可能'], shaders: ['光影下载', '让世界焕然一新'],
  network: ['联机', '和朋友一起玩'], downloads: ['下载管理', '查看文件下载与安装进度'], settings: ['启动器设置', '管理游戏目录与运行环境'],
};
const TYPE_LABELS = { release: '正式版', snapshot: '快照', old_beta: 'Beta', old_alpha: 'Alpha' };

function formatNumber(number = 0) {
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
  return String(number);
}
function formatBytes(bytes = 0) {
  if (!bytes) return '0 MB';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
function formatDate(date) {
  if (!date) return '从未游玩';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}
function timeAgo(date) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (days <= 0) return '今天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

function Logo({ compact = false }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}>
    <div className="brand-cube"><span>H</span><i /></div>
    {!compact && <div className="brand-type"><strong>HCL</strong><small>MINECRAFT LAUNCHER</small></div>}
  </div>;
}

function IconButton({ children, title, className = '', ...props }) {
  return <button className={`icon-button ${className}`} title={title} {...props}>{children}</button>;
}

function Modal({ title, subtitle, children, onClose, wide = false }) {
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`}>
      <header className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton title="关闭" onClick={onClose}><X size={19} /></IconButton></header>
      {children}
    </section>
  </div>;
}

function EmptyState({ icon: Icon = Box, title, text, action, onAction }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={28} /></div><h3>{title}</h3><p>{text}</p>{action && <button className="button secondary" onClick={onAction}>{action}</button>}</div>;
}

function HomePage({ instances, selected, settings, tasks, onLaunch, launching, running, onNavigate, onManage, onSelect, onOpenFolder, java, appVersion, onCheckUpdates, platform, account }) {
  const activeTasks = tasks.filter((task) => task.status === 'downloading');
  return <div className="page home-page">
    <section className="hero">
      <img className="hero-art" src="./hero-landscape.svg" alt="方块山地风景" />
      <div className="hero-content">
        <div className="eyebrow"><span /> YOUR WORLD, YOUR WAY</div>
        <h1>{selected ? <>继续探索，<br /><em>{settings.username}</em></> : <>下一段冒险，<br /><em>从这里开始。</em></>}</h1>
        <p>{selected ? `${selected.name} · ${selected.loader === 'Vanilla' ? '原版' : selected.loader}` : '安装一个游戏版本，创造属于你的世界。'}</p>
        <div className="hero-actions">
          <button className="button play-button" onClick={selected ? () => onLaunch(selected.id) : () => onNavigate('versions')} disabled={launching || running}>
            {launching ? <LoaderCircle className="spin" size={20} /> : running ? <Gamepad2 size={20} /> : <Play size={20} fill="currentColor" />}
            {launching ? '正在启动…' : running ? '游戏运行中' : selected ? '启动游戏' : '安装游戏'}
            {!launching && !running && <span className="keycap">↵</span>}
          </button>
          {selected && <button className="button hero-secondary" onClick={onManage}><Layers3 size={18} />切换实例</button>}
        </div>
        <div className="offline-note"><ShieldCheck size={14} /> 本地离线模式 · 游戏文件保存在你的电脑中</div>
      </div>
      {selected && <div className="hero-version"><span className="status-dot" />{selected.version}<small>{TYPE_LABELS[selected.type] || selected.type}</small></div>}
    </section>

    <div className="home-grid">
      <section className="home-main">
        <div className="section-heading"><div><h2>快速开始</h2><p>为你的世界增添一点新东西</p></div></div>
        <div className="quick-grid">
          <button className="quick-card mods-card" onClick={() => onNavigate('mods')}><div className="quick-icon"><Package size={24} /></div><div><h3>发现 Mod</h3><p>新玩法、新生物与实用工具</p></div><ArrowRight size={19} /></button>
          <button className="quick-card shaders-card" onClick={() => onNavigate('shaders')}><div className="quick-icon"><Sparkles size={24} /></div><div><h3>换个光影</h3><p>让熟悉的风景拥有全新质感</p></div><ArrowRight size={19} /></button>
        </div>
        <div className="section-heading instance-heading"><div><h2>我的实例</h2><p>{instances.length ? `共 ${instances.length} 个游戏实例` : '安装版本后会显示在这里'}</p></div><button className="text-button" onClick={() => onNavigate('versions')}><Plus size={15} />新建实例</button></div>
        {instances.length ? <div className="instance-strip">{instances.slice(0, 3).map((instance, index) => <button key={instance.id} className={`instance-card ${selected?.id === instance.id ? 'selected' : ''}`} onClick={() => onSelect(instance.id)}>
          <div className={`instance-art art-${index % 3}`}><Pickaxe size={25} /><span>{instance.version}</span></div>
          <div className="instance-info"><strong>{instance.name}</strong><span>{instance.loader === 'Vanilla' ? '原版' : instance.loader} · {TYPE_LABELS[instance.type] || instance.type}</span><small><Clock3 size={12} />{formatDate(instance.lastPlayed)}</small></div>
          {selected?.id === instance.id && <span className="selected-check"><Check size={13} /></span>}
        </button>)}</div> : <div className="empty-instance"><div className="empty-cube"><Box size={25} /></div><div><strong>这里还是一片空地</strong><p>选择喜欢的 Minecraft 版本，一键创建实例。</p></div><button className="button secondary small" onClick={() => onNavigate('versions')}>浏览版本<ChevronRight size={15} /></button></div>}
      </section>
      <aside className="home-aside">
        <section className="side-card profile-card"><div className="side-card-title"><h3>玩家档案</h3><UserRound size={17} /></div><div className="player-row"><div className="player-avatar"><span>{(account?.name || settings.username || 'P').slice(0, 1).toUpperCase()}</span><i /></div><div><strong>{account?.name || settings.username}</strong><span>{account?.type === 'yggdrasil' ? `皮肤站 · ${(() => { try { return new URL(account.apiRoot).hostname; } catch { return '外置登录'; } })()}` : '离线玩家'}</span></div><span className="local-badge">{account?.type === 'yggdrasil' ? '外置' : '本地'}</span></div><div className="profile-stats"><div><strong>{instances.length}</strong><span>游戏实例</span></div><div><strong>{settings.memory / 1024} GB</strong><span>分配内存</span></div></div></section>
        <section className="side-card status-card"><div className="side-card-title"><h3>运行状态</h3><span className={`status-pill ${java?.found ? '' : 'warning'}`}>{java?.found ? '就绪' : '需配置'}</span></div><div className="status-line"><span><Zap size={15} />Java 环境</span><strong>{java?.found ? `Java ${java.version.split('_')[0]}` : '未检测到'}</strong></div><div className="status-line"><span><Download size={15} />活动下载</span><strong>{activeTasks.length} 个任务</strong></div><div className="status-line"><span><HardDrive size={15} />游戏目录</span><button title="打开游戏目录" onClick={onOpenFolder}>{platform === 'darwin' ? '家目录' : `${settings.gameDirectory?.slice(0, 1) || 'D'} 盘`} <FolderOpen size={13} /></button></div><div className="status-line"><span><RefreshCw size={15} />启动器版本</span><button title="检查启动器更新" onClick={onCheckUpdates}>v{appVersion || '?'} · 检查更新</button></div></section>
        <div className="tip-card"><Leaf size={18} /><p>小提示：Mod 与光影需要对应的加载器才能生效，下载时注意游戏版本。</p></div>
      </aside>
    </div>
  </div>;
}

function VersionsPage({ installed, onInstall, installing, settings }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('release');
  const [limit, setLimit] = useState(30);
  const [installTarget, setInstallTarget] = useState(null);
  const [name, setName] = useState('');
  const [loader, setLoader] = useState('Vanilla');
  const [forgeBuilds, setForgeBuilds] = useState(null);
  const [forgeId, setForgeId] = useState('');
  const load = async (refresh = false) => {
    setLoading(true); setError('');
    try { setData(await window.hcl.getVersions(refresh)); }
    catch (e) { setError(e.message || '无法获取版本清单，请检查网络。'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => (data?.versions || []).filter((v) => (filter === 'all' || v.type === filter) && v.id.toLowerCase().includes(query.toLowerCase())), [data, filter, query]);
  useEffect(() => { setLimit(30); }, [filter, query]);
  useEffect(() => {
    if (!installTarget || loader !== 'Forge') return;
    let active = true;
    setForgeBuilds(null);
    setForgeId('');
    window.hcl.listForge(installTarget.id).then((data) => {
      if (!active) return;
      setForgeBuilds(data);
      setForgeId(data.recommended || data.latest || data.builds[0]?.id || '');
    }).catch((error) => active && setForgeBuilds({ builds: [], error: error.message }));
    return () => { active = false; };
  }, [installTarget, loader]);
  return <div className="page versions-page">
    <div className="page-toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索版本，例如 1.21.1" />{query && <button onClick={() => setQuery('')}><X size={15} /></button>}</div><button className="button secondary small" onClick={() => load(true)} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新清单</button></div>
    <div className="filter-row"><div className="segmented">{[['release', '正式版'], ['snapshot', '快照'], ['old_beta', 'Beta'], ['old_alpha', 'Alpha'], ['all', '全部']].map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><span className="result-count">{filtered.length} 个版本</span></div>
    <div className="source-notice"><ShieldCheck size={15} /><span>版本数据与游戏文件来自 Mojang 官方服务器</span><span className="source-separator" />下载完成后自动创建独立实例</div>
    {error ? <EmptyState icon={AlertCircle} title="版本清单加载失败" text={error} action="重新加载" onAction={() => load(true)} /> : loading && !data ? <div className="version-grid">{Array.from({ length: 9 }, (_, i) => <div className="version-card skeleton" key={i} />)}</div> : <>
      <div className="version-grid">{filtered.slice(0, limit).map((version) => {
        const isInstalled = installed.some((item) => item.version === version.id);
        return <article className="version-card" key={version.id}>
          <div className={`version-icon ${version.type}`}><Box size={25} /></div>
          <div className="version-info"><div className="version-title"><h3>Minecraft {version.id}</h3>{data.latest.release === version.id && <span className="latest-tag">最新</span>}</div><div className="version-meta"><span className={`type-tag ${version.type}`}>{TYPE_LABELS[version.type] || version.type}</span><span><CalendarDays size={12} />{new Date(version.releaseTime).toLocaleDateString('zh-CN')}</span></div></div>
          <button className={`button small ${isInstalled ? 'installed' : 'secondary'}`} onClick={() => { setInstallTarget(version); setName(`Minecraft ${version.id}`); setLoader('Vanilla'); setForgeBuilds(null); setForgeId(''); }} disabled={installing}><Download size={15} />{isInstalled ? '再次安装' : '安装'}</button>
        </article>;
      })}</div>
      {!filtered.length && <EmptyState icon={Search} title="没有找到这个版本" text="试试其他版本号或切换版本类型。" />}
      {filtered.length > limit && <button className="load-more" onClick={() => setLimit(limit + 30)}>显示更多版本<ChevronDown size={16} /></button>}
    </>}
    {installTarget && <Modal title="创建游戏实例" subtitle={`Minecraft ${installTarget.id} · ${TYPE_LABELS[installTarget.type]}`} onClose={() => !installing && setInstallTarget(null)}>
      <div className="modal-body"><label className="field"><span>实例名称</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus /></label><div className="loader-field"><span>运行加载器</span><div className="loader-options three"><button className={loader === 'Vanilla' ? 'selected' : ''} onClick={() => setLoader('Vanilla')}><Box size={18} /><div><strong>原版</strong><small>纯净体验</small></div>{loader === 'Vanilla' && <Check size={14} />}</button><button className={loader === 'Fabric' ? 'selected' : ''} onClick={() => setLoader('Fabric')}><Layers3 size={18} /><div><strong>Fabric</strong><small>轻量，支持 Iris 光影</small></div>{loader === 'Fabric' && <Check size={14} />}</button><button className={loader === 'Forge' ? 'selected' : ''} onClick={() => setLoader('Forge')}><Package size={18} /><div><strong>Forge</strong><small>模组生态最全</small></div>{loader === 'Forge' && <Check size={14} />}</button></div></div>
      {loader === 'Forge' && <div className="forge-picker">{forgeBuilds === null ? <span className="forge-loading"><LoaderCircle className="spin" size={14} />正在获取 Forge 版本列表…</span> : forgeBuilds.error ? <span className="forge-error"><AlertCircle size={14} />{forgeBuilds.error}</span> : <label className="field"><span>Forge 版本{forgeBuilds.recommended ? '（已推荐）' : ''}</span><select value={forgeId} onChange={(e) => setForgeId(e.target.value)}>{forgeBuilds.builds.map((build) => <option key={build.id} value={build.id}>{build.build}{build.build === forgeBuilds.recommended ? ' · 推荐' : ''}{build.build === forgeBuilds.latest && build.build !== forgeBuilds.recommended ? ' · 最新' : ''}</option>)}</select></label>}</div>}<div className="install-summary"><div><Box size={19} /><span>游戏版本<strong>{installTarget.id} · {loader}</strong></span></div><div><HardDrive size={19} /><span>安装位置<strong>{settings?.gameDirectory || 'D:\\HCL\\data\\games'}</strong></span></div></div><p className="modal-hint"><Info size={14} />客户端、资源文件和运行库将一并下载，所需空间因版本而异。</p></div>
      <footer className="modal-footer"><button className="button ghost" onClick={() => setInstallTarget(null)} disabled={installing}>取消</button><button className="button primary" disabled={!name.trim() || installing || (loader === 'Forge' && (!forgeId || !forgeBuilds || forgeBuilds.error))} onClick={() => { onInstall(installTarget, name, loader, forgeId).catch(() => {}); setInstallTarget(null); }}>{installing ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{installing ? '正在创建…' : '开始安装'}</button></footer>
    </Modal>}
  </div>;
}

function ResourceCard({ project, kind, onClick }) {
  const [imageError, setImageError] = useState(false);
  const localized = lookupProject(project);
  return <button className="resource-card" onClick={onClick}>
    <div className="resource-icon">{project.icon_url && !imageError ? <img src={project.icon_url} alt="" onError={() => setImageError(true)} /> : kind === 'mod' ? <Package size={30} /> : <Sparkles size={30} />}</div>
    <div className="resource-content"><div className="resource-title"><h3>{localized ? localized.zh : project.title}</h3>{localized && <span className="author">原名 {project.title} · by {project.author}</span>}{!localized && <span className="author">by {project.author}</span>}</div><p>{localized ? localized.desc : project.description}</p><div className="resource-tags">{project.categories?.filter((c) => ['fabric', 'forge', 'neoforge', 'quilt', 'iris', 'optifine', 'technology', 'adventure', 'utility', 'decoration', 'magic', 'food', 'worldgen'].includes(c)).slice(0, 3).map((category) => <span key={category}>{category}</span>)}</div><div className="resource-stats"><span><Download size={13} />{formatNumber(project.downloads)}</span><span><Clock3 size={13} />{timeAgo(project.date_modified)}</span><span className="resource-more">查看详情<ChevronRight size={13} /></span></div></div>
  </button>;
}

function ResourceBrowser({ kind, instances, selected, onDownload, onRequireInstance }) {
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('relevance');
  const [loader, setLoader] = useState(['Fabric', 'Forge', 'NeoForge', 'Quilt'].includes(selected?.loader) ? selected.loader.toLowerCase() : '');
  const [gameVersion, setGameVersion] = useState(selected?.version || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState(null);
  const [translated, setTranslated] = useState(null);
  const timer = useRef();
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const match = translateQuery(query);
      if (match && match.keyword !== query.trim()) {
        setSearch(match.keyword);
        setTranslated({ ...match, from: query.trim() });
      } else {
        setSearch(query);
        setTranslated(null);
      }
    }, 400);
    return () => clearTimeout(timer.current);
  }, [query]);
  useEffect(() => { setOffset(0); }, [search, sort, loader, gameVersion, kind]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    window.hcl.searchProjects({ query: search, kind, gameVersion, loader, sort, offset }).then((data) => {
      if (!active) return;
      setProjects((previous) => offset ? [...previous, ...data.hits] : data.hits);
      setTotal(data.total_hits);
    }).catch((e) => active && setError(e.message || '资源加载失败')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [search, sort, loader, gameVersion, offset, kind]);
  const title = kind === 'mod' ? 'Mod' : '光影';
  return <div className="page resources-page">
    <div className="resource-search-row"><div className="search-box resource-search"><Search size={19} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === 'mod' ? '搜索 Mod，支持中文：小地图、机械动力、优化…' : '搜索光影，支持中文：互补、BSL、低配光影…'} />{query && <button onClick={() => setQuery('')}><X size={15} /></button>}</div><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="relevance">相关度最高</option><option value="downloads">下载量最高</option><option value="newest">最新发布</option><option value="updated">最近更新</option></select></div>
    {translated && <div className="translate-hint"><Languages size={14} /><span>已将「{translated.from || query}」翻译为 <strong>{translated.keyword}</strong>{translated.entry ? `（${translated.entry.zh}）` : translated.category ? '（通用类别）' : ''}，Modrinth 资源以英文索引</span><button onClick={() => { setSearch(translated.from || query); setTranslated(null); }}>用原文搜索</button></div>}
    <div className="filter-row resource-filters"><div className="filter-selects"><select value={gameVersion} onChange={(e) => setGameVersion(e.target.value)}><option value="">全部游戏版本</option>{[...new Set(instances.map((i) => i.version))].map((version) => <option key={version} value={version}>{version}{selected?.version === version ? ' · 当前实例' : ''}</option>)}{!instances.length && <option value="1.21.1">1.21.1</option>}</select>{kind === 'mod' && <select value={loader} onChange={(e) => setLoader(e.target.value)}><option value="">全部加载器</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select>}</div><span className="result-count">{formatNumber(total)} 个{title}</span></div>
    <div className="source-notice modrinth"><span className="modrinth-mark">M</span><span>资源由 Modrinth 提供</span><span className="source-separator" />下载目标：{selected ? selected.name : '尚未选择实例'}{!selected && <button onClick={onRequireInstance}>去选择</button>}</div>
    {error && !projects.length ? <EmptyState icon={AlertCircle} title="资源加载失败" text={error} action="重试" onAction={() => setSearch(`${search} `)} /> : <>
      <div className="resource-grid">{projects.map((project) => <ResourceCard key={project.project_id} project={project} kind={kind} onClick={() => setDetail(project)} />)}{loading && Array.from({ length: offset ? 3 : 6 }, (_, i) => <div className="resource-card skeleton" key={`skeleton-${i}`} />)}</div>
      {!loading && !projects.length && <EmptyState icon={Search} title={`没有找到相关${title}`} text="换个关键词，或清除游戏版本与加载器筛选后再试试。" />}
      {projects.length < total && <button className="load-more" disabled={loading} onClick={() => setOffset((value) => value + 24)}>{loading ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}加载更多</button>}
    </>}
    {detail && <ProjectModal project={detail} kind={kind} selected={selected} gameVersion={gameVersion} loader={loader} onClose={() => setDetail(null)} onDownload={onDownload} onRequireInstance={onRequireInstance} />}
  </div>;
}

function ProjectModal({ project, kind, selected, gameVersion, loader, onClose, onDownload, onRequireInstance }) {
  const localized = lookupProject(project);
  const [versions, setVersions] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [iconError, setIconError] = useState(false);
  useEffect(() => {
    window.hcl.getProjectVersions(project.project_id, { gameVersion, loader, kind }).then((data) => {
      setVersions(data); setChosen(data[0] || null);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [project.project_id, gameVersion, loader, kind]);
  const file = chosen?.files?.find((item) => item.primary) || chosen?.files?.[0];
  const download = async () => {
    if (!selected) { onClose(); onRequireInstance(); return; }
    setDownloading(true);
    onDownload({ kind, instanceId: selected.id, projectTitle: localized ? localized.zh : project.title, file }).catch(() => {});
    onClose();
  };
  return <Modal title={localized ? localized.zh : project.title} subtitle={`${localized ? `原名 ${project.title} · ` : ''}${project.author} · ${formatNumber(project.downloads)} 次下载`} onClose={onClose} wide>
    <div className="project-overview"><div className="project-modal-icon">{project.icon_url && !iconError ? <img src={project.icon_url} onError={() => setIconError(true)} alt="" /> : kind === 'mod' ? <Package size={36} /> : <Sparkles size={36} />}</div><div><p>{localized ? localized.desc : project.description}</p><div className="resource-tags">{project.categories?.slice(0, 5).map((category) => <span key={category}>{category}</span>)}</div></div><a className="icon-button" href={project.project_url || `https://modrinth.com/${kind}/${project.slug}`} title="在 Modrinth 查看"><ExternalLink size={18} /></a></div>
    <div className="project-version-section"><div className="section-heading compact"><div><h3>选择发布版本</h3><p>{gameVersion ? `已按 Minecraft ${gameVersion} 筛选` : '显示所有兼容版本'}</p></div><span className="target-instance"><HardDrive size={14} />{selected?.name || '未选择实例'}</span></div>
      {loading ? <div className="version-loading"><LoaderCircle className="spin" size={22} />正在读取发布版本…</div> : error ? <div className="inline-error"><AlertCircle size={16} />{error}</div> : !versions.length ? <EmptyState icon={Info} title="没有匹配的版本" text="返回列表并清除游戏版本或加载器筛选后再试。" /> : <>
        <div className="release-list">{versions.slice(0, 12).map((version) => <button className={`release-row ${chosen?.id === version.id ? 'selected' : ''}`} key={version.id} onClick={() => setChosen(version)}><span className="radio-dot" /><div><strong>{version.name}</strong><span>{version.version_number} · {version.game_versions.join(', ')}</span></div><span className="release-type">{version.version_type}</span></button>)}</div>
        {chosen && <div className="download-file"><div><Package size={17} /><span>{file?.filename}<small>{file ? formatBytes(file.size) : ''} · {chosen.loaders.join(' / ')}</small></span></div><button className="button primary small" disabled={!file || downloading} onClick={download}>{downloading ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{selected ? `下载到${kind === 'mod' ? ' Mods' : '光影'}文件夹` : '先选择实例'}</button></div>}
      </>}
    </div>
  </Modal>;
}

function NetworkPage({ toast, settings }) {
  const [ips, setIps] = useState([]);
  const [downloaded, setDownloaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [token, setToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(Boolean(settings?.cpolarAuthToken));
  const [port, setPort] = useState('25565');
  const [address, setAddress] = useState('');
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const logBox = useRef(null);
  useEffect(() => {
    window.hcl.getLocalIps().then(setIps).catch(() => {});
    window.hcl.cpolarStatus().then((s) => { setDownloaded(Boolean(s.downloaded)); setRunning(Boolean(s.running)); }).catch(() => {});
  }, []);
  useEffect(() => {
    const offLog = window.hcl.listen('net:cpolar-log', (data) => setLogs((old) => [...old.slice(-50), String(data.text).trim()].filter(Boolean)));
    const offAddr = window.hcl.listen('net:cpolar-address', (data) => {
      setRunning(true);
      setAddress((old) => {
        if (!old) toast(`公网地址已就绪：${data.address}`);
        else if (old !== data.address) toast(`公网地址已更新：${data.address}`, 'info');
        return data.address;
      });
    });
    return () => { offLog(); offAddr(); };
  }, [toast]);
  useEffect(() => { if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight; }, [logs]);
  const copy = (text) => { navigator.clipboard?.writeText(text); toast('已复制到剪贴板'); };
  const download = async () => {
    setBusy(true);
    try { await window.hcl.downloadCpolar(); setDownloaded(true); toast('cpolar 隧道程序已就绪'); }
    catch (e) { toast(e.message || '下载失败', 'error'); }
    finally { setBusy(false); }
  };
  const start = async () => {
    setStarting(true);
    try {
      await window.hcl.startCpolar(port, token);
      setRunning(true);
      if (token.trim()) { setTokenSaved(true); setToken(''); }
      toast('隧道已启动，正在获取公网地址…');
    } catch (e) { toast(e.message || '启动失败', 'error'); }
    finally { setStarting(false); }
  };
  const stop = async () => { await window.hcl.stopCpolar(); setRunning(false); setAddress(''); };
  return <div className="page network-page">
    <div className="network-hero"><Network size={26} /><div><strong>和朋友联机</strong><p>同一网络下直连；不同网络用隧道穿透，把你的世界分享给任何人。</p></div></div>
    <div className="network-grid">
      <section className="panel-card">
        <div className="section-heading"><div><h3>局域网联机</h3><p>和你在同一个 Wi-Fi / 路由器下的朋友</p></div><Users size={18} /></div>
        <div className="ip-list">{ips.length ? ips.map((item) => <div className="ip-row" key={item.address}><span className="ip-addr">{item.address}</span><span className="ip-name">{item.name}</span><button className="text-button" onClick={() => copy(item.address)}><Copy size={13} />复制</button></div>) : <span className="forge-loading">未检测到局域网 IPv4 地址</span>}</div>
        <p className="net-note">步骤：游戏内按 ESC → 「对局域网开放」→ 端口会显示在聊天框 → 朋友在多人游戏中输入 <strong>你的IP:端口</strong> 即可加入。</p>
      </section>
      <section className="panel-card">
        <div className="section-heading"><div><h3>跨网络联机（cpolar 内网穿透）</h3><p>国内服务的免费隧道，任何网络的朋友都能加入</p></div><Globe size={18} /></div>
        <ol className="net-steps">
          <li>{downloaded ? <><CheckCircle2 size={14} /> 隧道程序已就绪</> : <>下载 cpolar 隧道程序（约 8 MB，官网国内直连）<button className="text-button" disabled={busy} onClick={download}>{busy ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}{busy ? '下载中…' : '下载'}</button></>}</li>
          <li>注册 cpolar 免费账号，在后台「验证」页复制 <strong>authtoken</strong> 粘贴到这里<button className="text-button" onClick={() => window.hcl.openCpolarDashboard()}><Globe size={13} />打开后台</button>
            <div className="net-input-row"><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={tokenSaved ? 'authtoken 已保存，可留空' : '粘贴你的 authtoken'} /></div>
          </li>
          <li>填入游戏端口（游戏内「对局域网开放」后聊天框显示的端口，专用服务器默认 25565），然后启动隧道
            <div className="net-input-row"><input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="25565" /></div>
            {running
              ? <button className="text-button stop-btn" onClick={stop}><X size={13} />停止隧道</button>
              : <button className="text-button" disabled={!downloaded || starting} onClick={start}>{starting ? <LoaderCircle className="spin" size={13} /> : <LogIn size={13} />}{starting ? '启动中…' : '启动隧道'}</button>}
          </li>
        </ol>
        {address && <div className="tunnel-address"><Globe size={15} /><code>{address}</code><button className="text-button" onClick={() => copy(address)}><Copy size={13} />复制地址</button></div>}
        {logs.length > 0 && <div className="net-log" ref={logBox}>{logs.map((line, i) => <div key={i}>{line}</div>)}</div>}
        <p className="net-note">朋友在多人游戏中「直接连接」输入上面的地址即可加入；免费版隧道地址每次重启会变化，重新分享即可。世界需先在游戏内「对局域网开放」（或开专用服务器）。</p>
      </section>
    </div>
  </div>;
}

function DownloadsPage({ tasks, onCancel, onClear, onOpenLog, onInstallUpdate }) {
  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  const active = sorted.filter((task) => task.status === 'downloading');
  return <div className="page downloads-page">
    <div className="download-summary"><div className="download-summary-icon"><Download size={25} /></div><div><strong>{active.length ? `${active.length} 个任务正在下载` : '下载队列很安静'}</strong><p>{active.length ? '可以离开此页面，下载会在后台继续。' : '安装游戏或下载 Mod、光影后，任务会显示在这里。'}</p></div>{sorted.length > 0 && <button className="button ghost small" onClick={onClear}>清除已完成</button>}</div>
    <div className="download-list">{sorted.map((task) => { const TaskIcon = { game: Box, shader: Sparkles, update: RefreshCw, java: Coffee }[task.kind] || Package; return <article className="download-task" key={task.id}><div className={`task-icon ${task.kind}`}><TaskIcon size={23} /></div><div className="task-body"><div className="task-heading"><div><strong>{task.title}</strong><span>{task.detail}</span></div><span className={`task-status ${task.status}`}>{task.status === 'downloading' ? `${Math.floor(task.progress)}%` : task.status === 'completed' ? <><CheckCircle2 size={15} />已完成</> : task.status === 'cancelled' ? '已取消' : <><XCircle size={15} />失败</>}</span></div><div className="progress-track"><i className={task.status} style={{ width: `${task.progress}%` }} /></div><div className="task-meta"><span>{task.total ? `${formatBytes(task.received)} / ${formatBytes(task.total)}` : task.kind === 'game' ? '正在准备游戏文件' : '正在连接资源服务器'}</span><time>{new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div></div>{task.status === 'downloading' && task.kind !== 'update' && <IconButton title="取消下载" onClick={() => onCancel(task.id)}><X size={17} /></IconButton>}
{task.kind === 'update' && task.status === 'completed' && <button className="button primary small" onClick={onInstallUpdate}><Rocket size={14} />重启安装</button>}
{task.status === 'error' && <button className="text-button log-open" onClick={onOpenLog}><FileText size={14} />失败日志</button>}</article>; })}{!sorted.length && <EmptyState icon={Download} title="还没有下载任务" text="去游戏版本、Mod 或光影页面找点喜欢的内容吧。" />}</div>
  </div>;
}

function SettingsPage({ settings, dataRoot, appVersion, platform, onCheckUpdates, onSave, onChooseJava, onChooseDirectory, onDetectJava, java, setJava, onOpenRoot, toast, accounts, currentAccountId, refreshAccounts }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [accountModal, setAccountModal] = useState(false);
  const [offlineName, setOfflineName] = useState('');
  const [authType, setAuthType] = useState('offline');
  const [customPreset, setCustomPreset] = useState('littleskin');
  const [customRoot, setCustomRoot] = useState('');
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  const update = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const applyTheme = async (id) => {
    update('theme', id);
    try { await onSave({ ...form, theme: id }); } catch {}
  };
  const save = async () => { setSaving(true); try { await onSave(form); } finally { setSaving(false); } };
  return <div className="page settings-page">
    <div className="settings-layout"><div className="settings-main">
      <section className="settings-section"><div className="settings-title"><UserRound size={19} /><div><h2>玩家设置</h2><p>用于离线模式的游戏内显示名称</p></div></div><label className="field horizontal"><span>玩家名称</span><div><input value={form.username} maxLength={16} onChange={(e) => update('username', e.target.value)} /><small>建议使用 3–16 个字母、数字或下划线</small></div></label><div className="toggle-row"><div><strong>游戏语言自动设为简体中文</strong><span>每次启动前自动写入语言设置，新实例第一次进入游戏即为中文界面</span></div><button className={`switch ${form.autoChineseLang !== false ? 'on' : ''}`} onClick={async () => { update('autoChineseLang', form.autoChineseLang === false); try { await onSave({ ...form, autoChineseLang: form.autoChineseLang === false }); } catch {} }}><i /></button></div></section>
      <section className="settings-section"><div className="settings-title"><Users size={19} /><div><h2>游戏账户</h2><p>离线账户或皮肤站账户（Yggdrasil 外置登录，进在线服务器时验证身份）</p></div><button className="check-update" onClick={() => setAccountModal(true)}><LogIn size={12} />添加账户</button></div>
        <div className="account-list">{accounts.map((item) => <div key={item.id} className={`account-row ${item.id === currentAccountId ? 'current' : ''}`} onClick={() => window.hcl.selectAccount(item.id).then(refreshAccounts).catch((e) => toast(e.message, 'error'))}><div className="mini-avatar">{item.name.slice(0, 1).toUpperCase()}<i /></div><div className="account-info"><strong>{item.name}</strong><span>{item.type === 'yggdrasil' ? (() => { try { return new URL(item.apiRoot).hostname; } catch { return '外置登录'; } })() : '离线模式'}</span></div>{item.id === currentAccountId && <span className="current-check"><CheckCircle2 size={15} />当前</span>}<button className="account-remove" title="删除账户" onClick={(e) => { e.stopPropagation(); window.hcl.removeAccount(item.id).then(refreshAccounts).catch((err) => toast(err.message, 'error')); }}><Trash2 size={14} /></button></div>)}
          {!accounts.length && <div className="forge-loading">还没有账户，点击右上角「添加账户」创建</div>}
        </div></section>
      <section className="settings-section"><div className="settings-title"><Palette size={19} /><div><h2>外观主题</h2><p>选择启动器的强调色，点击立即生效并保存</p></div></div><div className="theme-grid">{THEMES.map((theme) => <button key={theme.id} className={`theme-card ${form.theme === theme.id ? 'selected' : ''}`} onClick={() => applyTheme(theme.id)}><span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${theme.c1}, ${theme.c2})` }} /><span>{theme.name}{form.theme === theme.id && <Check size={13} />}</span></button>)}</div></section>
      <section className="settings-section"><div className="settings-title"><Zap size={19} /><div><h2>Java 环境</h2><p>启动 Minecraft 所需的 Java 运行环境</p></div></div><div className="java-status"><div className={`java-status-icon ${java?.found ? 'ok' : ''}`}>{java?.found ? <Check size={20} /> : <AlertCircle size={20} />}</div><div><strong>{java?.found ? `已检测到 Java ${java.version}` : '未检测到可用的 Java'}</strong><span>{java?.found ? java.path : '1.20.5 及以上建议 Java 21，较新版本建议 Java 17'}</span></div><div className="java-actions">{!java?.found && <a className="button secondary small" href="https://adoptium.net/temurin/releases/?version=21" target="_blank" rel="noreferrer"><Download size={14} />获取 Java 21</a>}<button className="button secondary small" onClick={async () => { setJava(null); setJava(await onDetectJava()); }}><RefreshCw size={14} />重新检测</button></div></div><label className="field horizontal"><span>Java 路径</span><div className="path-input"><input value={form.javaPath} onChange={(e) => update('javaPath', e.target.value)} placeholder="留空以自动检测 java.exe" /><button className="button secondary small" onClick={async () => { const file = await onChooseJava(); if (file) update('javaPath', file); }}>浏览</button></div></label><div className="field horizontal"><span>游戏内存</span><div className="memory-control"><div><MemoryStick size={16} /><input type="range" min="1024" max="16384" step="512" value={form.memory} onChange={(e) => update('memory', Number(e.target.value))} /><strong>{(form.memory / 1024).toFixed(1)} GB</strong></div><small>通常分配 4 GB 即可；大型 Mod 整合包可适当增加</small></div></div><div className="toggle-row"><div><strong>自动下载缺失的 Java</strong><span>启动时自动匹配游戏版本所需的 Java（8/17/21），缺失时从 Adoptium 下载安装到启动器数据目录（国内走清华镜像）</span></div><button className={`switch ${form.autoDownloadJava !== false ? 'on' : ''}`} onClick={async () => { const next = form.autoDownloadJava === false; update('autoDownloadJava', next); try { await onSave({ ...form, autoDownloadJava: next }); } catch {} }}><i /></button></div></section>
      <section className="settings-section"><div className="settings-title"><HardDrive size={19} /><div><h2>存储位置</h2><p>游戏实例、Mod 和光影的保存目录</p></div></div><label className="field horizontal"><span>游戏目录</span><div className="path-input"><input value={form.gameDirectory} onChange={(e) => update('gameDirectory', e.target.value)} /><button className="button secondary small" onClick={async () => { const folder = await onChooseDirectory(); if (folder) update('gameDirectory', folder); }}>浏览</button></div></label><div className="storage-note"><Info size={15} /><span>配置与缓存目录：{dataRoot}</span><button onClick={onOpenRoot}><FolderOpen size={14} />打开</button></div></section>
      <section className="settings-section"><div className="settings-title"><Rocket size={19} /><div><h2>启动器更新</h2><p>自动检查新版本并在后台下载，重启后即可完成安装</p></div></div><div className="toggle-row"><div><strong>自动检查并下载更新</strong><span>开启后，启动时和运行中每 4 小时各检查一次；关闭后仍可在右侧关于卡片手动检查</span></div><button className={`switch ${form.autoUpdate !== false ? 'on' : ''}`} onClick={async () => { const next = form.autoUpdate === false; update('autoUpdate', next); try { await onSave({ ...form, autoUpdate: next }); } catch {} }}><i /></button></div></section>
      <button className="button primary save-settings" disabled={saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}保存设置</button>
      {accountModal && <Modal title="添加游戏账户" subtitle="离线账户或皮肤站账户（Yggdrasil 外置登录）" onClose={() => setAccountModal(false)}>
        <div className="segmented">{[['offline', '离线模式'], ['yggdrasil', '皮肤站账户']].map(([id, label]) => <button key={id} className={authType === id ? 'active' : ''} onClick={() => setAuthType(id)}>{label}</button>)}</div>
        {authType === 'offline' ? <label className="field"><span>玩家名称</span><input value={offlineName} maxLength={16} placeholder="3–16 位字母、数字或下划线" onChange={(e) => setOfflineName(e.target.value)} /></label>
        : <>
          <label className="field"><span>认证服务器</span><select value={customPreset} onChange={(e) => setCustomPreset(e.target.value)}><option value="littleskin">LittleSkin（littleskin.cn）</option><option value="custom">自定义 Yggdrasil 服务器…</option></select></label>
          {customPreset === 'custom' && <label className="field"><span>API 根地址</span><input value={customRoot} placeholder="https://example.com/api/yggdrasil" onChange={(e) => setCustomRoot(e.target.value)} /></label>}
          <label className="field"><span>账号（邮箱 / 用户名）</span><input value={authUser} autoComplete="off" onChange={(e) => setAuthUser(e.target.value)} /></label>
          <label className="field"><span>密码</span><input type="password" value={authPass} autoComplete="off" onChange={(e) => setAuthPass(e.target.value)} /></label>
          <p className="net-note">使用皮肤站账号进入开启外置登录的在线服务器；尚未注册？先到 littleskin.cn 注册并创建角色。密码仅用于向认证服务器登录，不会保存在本机。</p>
        </>}
        <button className="button primary" disabled={authBusy} onClick={async () => {
          setAuthBusy(true);
          try {
            if (authType === 'offline') {
              if (!offlineName.trim()) throw new Error('请输入玩家名称');
              await window.hcl.addOfflineAccount(offlineName.trim());
              toast('离线账户已添加');
            } else {
              const root = customPreset === 'littleskin' ? 'https://littleskin.cn/api/yggdrasil' : customRoot;
              if (!root || !/^https:\/\//.test(root)) throw new Error('请填写有效的 API 根地址（https:// 开头）');
              const result = await window.hcl.loginAccount({ apiRoot: root, username: authUser, password: authPass });
              toast(`欢迎，${result.name}！皮肤站账户登录成功`);
            }
            setAccountModal(false); setOfflineName(''); setAuthUser(''); setAuthPass('');
          } catch (e) { toast(e.message || '操作失败', 'error'); }
          finally { setAuthBusy(false); }
        }}>{authBusy ? <LoaderCircle className="spin" size={17} /> : authType === 'offline' ? '创建离线账户' : '登录'}</button>
      </Modal>}
    </div><aside className="settings-aside"><div className="about-card"><Logo /><div className="about-version"><span>版本 {appVersion || '1.6.1'}</span><span>{platform === 'darwin' ? 'macOS' : 'Windows'}</span><button className="check-update" onClick={onCheckUpdates}><RefreshCw size={12} />检查更新</button></div><p>一个简单、清爽的 Minecraft 启动器。专注于游戏与社区内容，不做多余的事情。</p><div className="about-features"><span><Check size={14} />官方游戏版本</span><span><Check size={14} />Modrinth 资源</span><span><Check size={14} />本地实例管理</span></div></div><div className="legal-note">Minecraft 是 Mojang Synergies AB 的商标。HCL 不是官方 Minecraft 产品，与 Mojang 或 Microsoft 无隶属关系。</div></aside></div>
  </div>;
}

function InstanceModal({ instances, selectedId, onClose, onSelect, onDelete, onOpenFolder, onNew }) {
  return <Modal title="我的游戏实例" subtitle="每个实例都有独立的存档、Mod 与光影文件" onClose={onClose} wide><div className="instance-modal-list">{instances.map((instance) => <div className={`instance-modal-row ${selectedId === instance.id ? 'selected' : ''}`} key={instance.id}><button className="instance-select" onClick={() => { onSelect(instance.id); onClose(); }}><div className="instance-modal-icon"><Pickaxe size={22} /></div><div><strong>{instance.name}</strong><span>Minecraft {instance.version} · {instance.loader === 'Vanilla' ? '原版' : instance.loader}</span><small>最近游玩：{formatDate(instance.lastPlayed)}</small></div>{selectedId === instance.id && <span className="current-tag">当前实例</span>}</button><div className="instance-row-actions"><IconButton title="打开实例文件夹" onClick={() => onOpenFolder(instance.id)}><FolderOpen size={17} /></IconButton><IconButton title="删除实例" className="danger" onClick={() => { if (window.confirm(`确定删除“${instance.name}”吗？\n该实例的存档、Mod 和配置都会移入回收站。`)) onDelete(instance.id); }}><Trash2 size={17} /></IconButton></div></div>)}{!instances.length && <EmptyState title="还没有游戏实例" text="先安装一个 Minecraft 版本。" />}</div><footer className="modal-footer"><span className="modal-hint">删除实例会同时删除其中的存档，请谨慎操作。</span><button className="button primary small" onClick={() => { onClose(); onNew(); }}><Plus size={15} />新建实例</button></footer></Modal>;
}

export default function App() {
  const [page, setPage] = useState('home');
  const [state, setState] = useState({ settings: { username: 'Player', memory: 4096 }, instances: [], tasks: [], dataRoot: 'D:\\HCL\\data', appVersion: '1.6.5', platform: 'win32' });
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [instanceModal, setInstanceModal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [running, setRunning] = useState([]);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
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
    window.hcl.getState().then(async (data) => { setState(data); setRunning(data.running || []); setReady(true); setJava(await window.hcl.detectJava()); }).catch((e) => toast(e.message, 'error'));
    refreshAccounts();
    const offAccounts = window.hcl.listen('accounts:update', refreshAccounts);
    const offTask = window.hcl.onTask((task) => setState((old) => ({ ...old, tasks: [...old.tasks.filter((item) => item.id !== task.id), task] })));
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
    return () => { offTask(); offInstances(); offLog(); offUpdate(); offAccounts(); };
  }, [toast, refreshAccounts]);
  const prevThemeRef = useRef(null);
  useEffect(() => {
    const next = state.settings.theme || 'green';
    prevThemeRef.current = next;
    document.documentElement.dataset.theme = next;
  }, [state.settings.theme]);
  const selected = state.instances.find((item) => item.id === state.settings.selectedInstanceId) || state.instances[0];
  const currentAccount = accounts.find((item) => item.id === currentAccountId) || accounts[0] || null;
  const activeDownloads = state.tasks.filter((task) => task.status === 'downloading').length;
  const navigate = (next) => setPage(next);
  const selectInstance = async (id) => {
    await window.hcl.selectInstance(id);
    setState((old) => ({ ...old, settings: { ...old.settings, selectedInstanceId: id } }));
  };
  const install = async (version, name, loader = 'Vanilla', forgeId = null) => {
    setInstalling(true);
    try {
      const result = await window.hcl.installVersion(version, name, loader, forgeId);
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
  const checkUpdates = async () => {
    try {
      const result = await window.hcl.checkForUpdates();
      if (result?.status === 'none') toast('当前已是最新版本');
      else if (result?.status === 'dev') toast('开发模式下暂不支持应用内更新', 'info');
      else if (result?.status === 'unsupported') toast('当前平台暂不支持应用内更新，请从 GitHub Releases 下载新版本', 'info');
      else if (result?.status === 'available') toast(`发现新版本 v${result.version}，正在后台下载`);
      else if (result?.status === 'error') toast(`检查更新失败：${result.message}`, 'error');
    } catch (e) { toast(e.message || '检查更新失败', 'error'); }
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
  if (!ready) return <div className="app-loading"><Logo /><LoaderCircle className="spin" size={22} /><span>正在准备你的世界…</span></div>;
  return <div className={`app-shell ${isMac ? 'platform-mac' : ''}`}>
    <header className="titlebar"><div className="titlebar-brand"><Logo compact /></div><div className="window-title"><span>HCL</span><i />{PAGE_META[page][0]}</div>{!isMac && <div className="window-controls"><button onClick={() => window.hcl.windowMinimize()}><Minus size={16} /></button><button onClick={() => window.hcl.windowMaximize()}><Square size={13} /></button><button className="window-close" onClick={() => window.hcl.windowClose()}><X size={17} /></button></div>}</header>
    <aside className="sidebar"><div className="sidebar-brand"><Logo /></div><nav className="main-nav"><span className="nav-label">启动器</span>{NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19} /><span>{label}</span>{id === 'downloads' && activeDownloads > 0 && <b>{activeDownloads}</b>}{page === id && <i />}</button>)}</nav><div className="sidebar-bottom"><button className={`settings-nav ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={19} /><span>设置</span></button><button className="sidebar-player" onClick={() => navigate('settings')}><div className="mini-avatar">{state.settings.username.slice(0, 1).toUpperCase()}<i /></div><div><strong>{state.settings.username}</strong><span>离线模式</span></div><ChevronRight size={15} /></button>{updateInfo?.status === 'ready'
        ? <div className="sidebar-version ready" title="重启后自动完成安装" onClick={() => window.hcl.installUpdate()}>v{updateInfo.version} 已就绪 <span>•</span> 点击重启安装</div>
        : updateInfo?.status === 'downloading'
          ? <div className="sidebar-version" title="新版本正在后台下载">正在下载更新 {Math.floor(updateInfo.percent || 0)}%</div>
          : updateInfo?.status === 'error'
            ? <div className="sidebar-version error" title="点击重试检查更新" onClick={checkUpdates}>更新检查失败 <span>•</span> 点击重试</div>
            : <div className="sidebar-version" title="点击检查启动器更新" onClick={checkUpdates}>HCL v{state.appVersion || '1.6.5'} <span>•</span> 点击检查更新</div>}</div></aside>
    <main className="main-area"><div className="page-header"><div><h1>{PAGE_META[page][0]}</h1><p>{PAGE_META[page][1]}</p></div>{page === 'home' && <button className="current-instance" onClick={() => setInstanceModal(true)}><div className="current-instance-icon"><Gamepad2 size={18} /></div><div><span>当前实例</span><strong>{selected?.name || '尚未安装游戏'}</strong></div><ChevronDown size={16} /></button>}</div><div className="page-scroll">
      {page === 'home' && <HomePage instances={state.instances} selected={selected} settings={state.settings} tasks={state.tasks} onLaunch={launch} launching={launching} running={selected && running.includes(selected.id)} onNavigate={navigate} onManage={() => setInstanceModal(true)} onSelect={selectInstance} onOpenFolder={() => window.hcl.openFolder('games')} java={java} appVersion={state.appVersion} onCheckUpdates={checkUpdates} platform={state.platform} account={currentAccount} />}
      {page === 'versions' && <VersionsPage installed={state.instances} onInstall={install} installing={installing} settings={state.settings} />}
      {(page === 'mods' || page === 'shaders') && <ResourceBrowser key={page} kind={page === 'mods' ? 'mod' : 'shader'} instances={state.instances} selected={selected} onDownload={downloadResource} onRequireInstance={() => selected ? setInstanceModal(true) : navigate('versions')} />}
      {page === 'downloads' && <DownloadsPage tasks={state.tasks} onCancel={window.hcl.cancelTask} onOpenLog={() => window.hcl.openErrorLog()} onInstallUpdate={() => window.hcl.installUpdate()} onClear={async () => { const tasks = await window.hcl.clearTasks(); setState((old) => ({ ...old, tasks })); }} />}
      {page === 'network' && <NetworkPage toast={toast} settings={state.settings} />}
      {page === 'settings' && <SettingsPage settings={state.settings} dataRoot={state.dataRoot} appVersion={state.appVersion} platform={state.platform} onCheckUpdates={checkUpdates} onSave={saveSettings} onChooseJava={window.hcl.chooseJava} onChooseDirectory={window.hcl.chooseGameDirectory} onDetectJava={window.hcl.detectJava} java={java} setJava={setJava} onOpenRoot={() => window.hcl.openFolder('root')} toast={toast} accounts={accounts} currentAccountId={currentAccountId} refreshAccounts={refreshAccounts} />}
    </div></main>
    {instanceModal && <InstanceModal instances={state.instances} selectedId={selected?.id} onClose={() => setInstanceModal(false)} onSelect={selectInstance} onDelete={deleteInstance} onOpenFolder={(id) => window.hcl.openFolder('instance', id)} onNew={() => navigate('versions')} />}
    {updateInfo?.status === 'ready' && !updateBannerDismissed && <div className="update-banner">
      <div className="update-banner-icon"><Rocket size={20} /></div>
      <div className="update-banner-body"><strong>HCL v{updateInfo.version} 已就绪</strong><span>重启启动器即可完成安装，只需几秒钟</span></div>
      <button className="button primary small" onClick={() => window.hcl.installUpdate()}>立即重启</button>
      <button className="button ghost small" onClick={() => setUpdateBannerDismissed(true)}>稍后</button>
    </div>}
    <div className="toast-stack">{toasts.map((item) => <div className={`toast ${item.type}`} key={item.id}>{item.type === 'error' ? <AlertCircle size={18} /> : item.type === 'info' ? <Info size={18} /> : <CheckCircle2 size={18} />}<span>{item.message}</span><button onClick={() => setToasts((old) => old.filter((t) => t.id !== item.id))}><X size={14} /></button></div>)}</div>
  </div>;
}

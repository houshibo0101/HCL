import { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle, Box, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Download, HardDrive, Info,
  Layers3, Leaf, LoaderCircle, Package, RefreshCw, Search, ShieldCheck, Sparkles, X, Zap,
} from 'lucide-react';
import { EmptyState } from '../components/chrome';
import { TYPE_LABELS } from '../constants';

export function VersionsPage({ installed, onInstall, installing, settings }) {
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
  const [quiltLoaders, setQuiltLoaders] = useState(null);
  const [shaderLoader, setShaderLoader] = useState(false);
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
      // recommended/latest 是纯版本号，优先映射到 builds 里的完整 id（带版本前缀）
      const preferred = data.recommended || data.latest;
      const exact = preferred && data.builds.find((b) => b.build === preferred);
      setForgeId(exact ? exact.id : (preferred || data.builds[0]?.id || ''));
    }).catch((error) => active && setForgeBuilds({ builds: [], error: error.message }));
    return () => { active = false; };
  }, [installTarget, loader]);
  useEffect(() => {
    if (!installTarget || loader !== 'NeoForge') return;
    let active = true;
    setForgeBuilds(null);
    setForgeId('');
    window.hcl.listNeoForge(installTarget.id).then((data) => {
      if (!active) return;
      setForgeBuilds(data);
      setForgeId(data.builds[0]?.id || '');
    }).catch((error) => active && setForgeBuilds({ builds: [], error: error.message }));
    return () => { active = false; };
  }, [installTarget, loader]);
  useEffect(() => {
    if (!installTarget || loader !== 'Quilt') return;
    let active = true;
    setQuiltLoaders(null);
    window.hcl.listQuilt(installTarget.id).then((data) => {
      if (!active) return;
      setQuiltLoaders(data);
    }).catch((error) => active && setQuiltLoaders({ loaders: [], error: error.message }));
    return () => { active = false; };
  }, [installTarget, loader]);
  // 安装配置视图：点击「安装」后页面整体切换到独立的安装选项页（不再用弹窗）
  if (installTarget) return <div className="page install-page">
    <button className="text-button back" onClick={() => !installing && setInstallTarget(null)}><ChevronRight size={15} />返回版本列表</button>
    <div className="install-hero">
      <div className={`version-icon ${installTarget.type} large`}><Box size={34} /></div>
      <div>
        <h2>创建游戏实例</h2>
        <p>Minecraft {installTarget.id} · {TYPE_LABELS[installTarget.type]} · 按下面步骤完成安装选项</p>
      </div>
    </div>
    <div className="install-layout">
      <section className="install-card">
        <label className="field"><span>实例名称</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <div className="loader-field"><span>运行加载器</span><div className="loader-options five">
          <button className={loader === 'Vanilla' ? 'selected' : ''} onClick={() => setLoader('Vanilla')}><Box size={18} /><div><strong>原版</strong><small>纯净体验</small></div>{loader === 'Vanilla' && <Check size={14} />}</button>
          <button className={loader === 'Fabric' ? 'selected' : ''} onClick={() => setLoader('Fabric')}><Layers3 size={18} /><div><strong>Fabric</strong><small>轻量快速</small></div>{loader === 'Fabric' && <Check size={14} />}</button>
          <button className={loader === 'Forge' ? 'selected' : ''} onClick={() => setLoader('Forge')}><Package size={18} /><div><strong>Forge</strong><small>模组生态最全</small></div>{loader === 'Forge' && <Check size={14} />}</button>
          <button className={loader === 'NeoForge' ? 'selected' : ''} onClick={() => setLoader('NeoForge')}><Zap size={18} /><div><strong>NeoForge</strong><small>Forge 现代分支</small></div>{loader === 'NeoForge' && <Check size={14} />}</button>
          <button className={loader === 'Quilt' ? 'selected' : ''} onClick={() => setLoader('Quilt')}><Leaf size={18} /><div><strong>Quilt</strong><small>Fabric 社区分支</small></div>{loader === 'Quilt' && <Check size={14} />}</button>
        </div></div>
        {(loader === 'Forge' || loader === 'NeoForge') && <div className="forge-picker">{forgeBuilds === null ? <span className="forge-loading"><LoaderCircle className="spin" size={14} />正在获取 {loader} 版本列表…</span> : forgeBuilds.error ? <span className="forge-error"><AlertCircle size={14} />{forgeBuilds.error}</span> : <label className="field"><span>{loader} 版本{forgeBuilds.recommended ? '（已推荐）' : ''}</span><select value={forgeId} onChange={(e) => setForgeId(e.target.value)}>{forgeBuilds.builds.map((build) => <option key={build.id} value={build.id}>{build.build}{build.build === forgeBuilds.recommended ? ' · 推荐' : ''}{build.build === forgeBuilds.latest && build.build !== forgeBuilds.recommended ? ' · 最新' : ''}</option>)}</select></label>}</div>}
        {loader === 'Quilt' && <div className="forge-picker">{quiltLoaders === null ? <span className="forge-loading"><LoaderCircle className="spin" size={14} />正在获取 Quilt 加载器版本…</span> : quiltLoaders.error ? <span className="forge-error"><AlertCircle size={14} />{quiltLoaders.error}</span> : <div className="quilt-note"><CheckCircle2 size={14} /><span>将自动安装最新稳定版 Quilt Loader {quiltLoaders.loaders[0] || ''}，无需手动选择。</span></div>}</div>}
        {(loader === 'Fabric' || loader === 'Quilt') && <div className="shader-toggle-row">
          <button className={`shader-switch ${shaderLoader ? 'on' : ''}`} onClick={() => setShaderLoader(!shaderLoader)} aria-label="安装 Iris 光影加载器"><i /></button>
          <div><strong>安装 Iris 光影加载器</strong><span>自动下载 Iris + Sodium 性能组件到 mods 文件夹，装完即可直接使用光影包</span></div>
          <Sparkles size={17} className="shader-toggle-icon" />
        </div>}
        <div className="install-summary"><div><Box size={19} /><span>游戏版本<strong>{installTarget.id} · {loader}</strong></span></div><div><HardDrive size={19} /><span>安装位置<strong>{settings?.gameDirectory || 'D:\\HCL\\data\\games'}</strong></span></div></div>
        <p className="modal-hint"><Info size={14} />客户端、资源文件和运行库将一并下载，所需空间因版本而异。安装进度可在「下载管理」查看。</p>
        <div className="install-actions">
          <button className="button ghost" onClick={() => setInstallTarget(null)} disabled={installing}>取消</button>
          <button className="button primary" disabled={!name.trim() || installing || ((loader === 'Forge' || loader === 'NeoForge') && (!forgeId || !forgeBuilds || forgeBuilds.error))} onClick={() => { onInstall(installTarget, name, loader, forgeId, shaderLoader ? 'Iris' : null).catch(() => {}); setInstallTarget(null); }}>{installing ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{installing ? '正在创建…' : '开始安装'}</button>
        </div>
      </section>
      <aside className="install-side">
        <h3>安装后你会得到</h3>
        <ul>
          <li><Box size={15} />一个独立的游戏实例，与现有版本互不干扰</li>
          <li><HardDrive size={15} />独立的 mods / saves / shaderpacks 文件夹</li>
          <li><ShieldCheck size={15} />数据全部保留在本地，随附完整卸载方式</li>
        </ul>
        <div className="install-side-tip"><Info size={14} /><span>加载器可以装完再换吗？——每个实例的加载器在创建时确定，想换加载器再建一个新实例即可，实例之间完全隔离。</span></div>
      </aside>
    </div>
    <p className="modal-hint install-dismiss-hint"><Info size={14} />确认选项后点「开始安装」，页面会自动返回版本列表，下载进度在「下载管理」页实时可见。</p>
  </div>;
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
          <button className={`button small ${isInstalled ? 'installed' : 'secondary'}`} onClick={() => { setInstallTarget(version); setName(`Minecraft ${version.id}`); setLoader('Vanilla'); setForgeBuilds(null); setForgeId(''); setShaderLoader(false); }} disabled={installing}><Download size={15} />{isInstalled ? '再次安装' : '安装'}</button>
        </article>;
      })}</div>
      {!filtered.length && <EmptyState icon={Search} title="没有找到这个版本" text="试试其他版本号或切换版本类型。" />}
      {filtered.length > limit && <button className="load-more" onClick={() => setLimit(limit + 30)}>显示更多版本<ChevronDown size={16} /></button>}
    </>}
  </div>;
}

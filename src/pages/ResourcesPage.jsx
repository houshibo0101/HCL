import { useState, useEffect, useRef } from 'react';
import {
  AlertCircle, ChevronRight, Clock3, Download, ExternalLink, HardDrive, Info, LoaderCircle, Package, Plus,
  Search, Sparkles, X, Languages,
} from 'lucide-react';
import { formatNumber, formatBytes, timeAgo } from '../lib/format';
import { EmptyState } from '../components/chrome';
import { translateQuery, lookupProject } from '../modDictionary';

export function ResourceCard({ project, kind, onClick }) {
  const [imageError, setImageError] = useState(false);
  const localized = lookupProject(project);
  return <button className="resource-card" onClick={onClick}>
    <div className="resource-icon">{project.icon_url && !imageError ? <img src={project.icon_url} alt="" onError={() => setImageError(true)} /> : kind === 'mod' ? <Package size={30} /> : <Sparkles size={30} />}</div>
    <div className="resource-content"><div className="resource-title"><h3>{localized ? localized.zh : project.title}</h3>{localized && <span className="author">原名 {project.title} · by {project.author}</span>}{!localized && <span className="author">by {project.author}</span>}</div><p>{localized ? localized.desc : project.description}</p><div className="resource-tags">{project.categories?.filter((c) => ['fabric', 'forge', 'neoforge', 'quilt', 'iris', 'optifine', 'technology', 'adventure', 'utility', 'decoration', 'magic', 'food', 'worldgen'].includes(c)).slice(0, 3).map((category) => <span key={category}>{category}</span>)}</div><div className="resource-stats"><span><Download size={13} />{formatNumber(project.downloads)}</span><span><Clock3 size={13} />{timeAgo(project.date_modified)}</span><span className="resource-more">查看详情<ChevronRight size={13} /></span></div></div>
  </button>;
}

export function ResourceBrowser({ kind, instances, selected, onDownload, onRequireInstance }) {
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
  // 详情视图：点击资源卡片后整页切换到独立详情页（不再用弹窗）
  if (detail) return <ProjectDetail project={detail} kind={kind} selected={selected} gameVersion={gameVersion} loader={loader} onBack={() => setDetail(null)} onDownload={onDownload} onRequireInstance={onRequireInstance} />;
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
  </div>;
}

export function ProjectDetail({ project, kind, selected, gameVersion, loader, onBack, onDownload, onRequireInstance }) {
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
    if (!selected) { onBack(); onRequireInstance(); return; }
    setDownloading(true);
    onDownload({ kind, instanceId: selected.id, projectTitle: localized ? localized.zh : project.title, file }).catch(() => {});
    onBack();
  };
  return <div className="page project-page">
    <button className="text-button back" onClick={onBack}><ChevronRight size={15} />返回{kind === 'mod' ? ' Mod' : '光影'}列表</button>
    <div className="install-hero">
      <div className="project-page-icon">{project.icon_url && !iconError ? <img src={project.icon_url} onError={() => setIconError(true)} alt="" /> : kind === 'mod' ? <Package size={36} /> : <Sparkles size={36} />}</div>
      <div className="project-hero-info">
        <h2>{localized ? localized.zh : project.title}</h2>
        <p>{localized ? `原名 ${project.title} · ` : ''}{project.author} · {formatNumber(project.downloads)} 次下载 · {timeAgo(project.date_modified)}更新</p>
        <div className="resource-tags">{project.categories?.slice(0, 6).map((category) => <span key={category}>{category}</span>)}</div>
      </div>
      <a className="icon-button project-page-link" href={project.project_url || `https://modrinth.com/${kind}/${project.slug}`} title="在 Modrinth 查看" target="_blank" rel="noreferrer"><ExternalLink size={18} /></a>
    </div>
    <p className="project-page-desc">{localized ? localized.desc : project.description}</p>
    <div className="project-page-section">
      <div className="section-heading compact"><div><h3>选择发布版本</h3><p>{gameVersion ? `已按 Minecraft ${gameVersion} 筛选` : '显示所有兼容版本'}</p></div><span className="target-instance"><HardDrive size={14} />{selected?.name || '未选择实例'}</span></div>
      {loading ? <div className="version-loading"><LoaderCircle className="spin" size={22} />正在读取发布版本…</div> : error ? <div className="inline-error"><AlertCircle size={16} />{error}</div> : !versions.length ? <EmptyState icon={Info} title="没有匹配的版本" text="返回列表并清除游戏版本或加载器筛选后再试。" /> : <>
        <div className="release-list">{versions.slice(0, 12).map((version) => <button className={`release-row ${chosen?.id === version.id ? 'selected' : ''}`} key={version.id} onClick={() => setChosen(version)}><span className="radio-dot" /><div><strong>{version.name}</strong><span>{version.version_number} · {version.game_versions.join(', ')}</span></div><span className="release-type">{version.version_type}</span></button>)}</div>
        {chosen && <div className="download-file"><div><Package size={17} /><span>{file?.filename}<small>{file ? formatBytes(file.size) : ''} · {chosen.loaders.join(' / ')}</small></span></div><button className="button primary small" disabled={!file || downloading} onClick={download}>{downloading ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{selected ? `下载到${kind === 'mod' ? ' Mods' : '光影'}文件夹` : '先选择实例'}</button></div>}
      </>}
    </div>
  </div>;
}

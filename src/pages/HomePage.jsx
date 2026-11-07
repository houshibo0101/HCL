import {
  ArrowRight, Box, Check, ChevronRight, Clock3, Download, FolderOpen, Gamepad2, HardDrive, Layers3,
  Leaf, LoaderCircle, Package, Pickaxe, Play, Plus, RefreshCw, ShieldCheck, Sparkles, UserRound,
  Zap,
} from 'lucide-react';
import { formatDate } from '../lib/format';
import { TYPE_LABELS } from '../constants';
import { useTasks } from '../lib/task-store';

export function HomePage({ instances, selected, settings, onLaunch, launching, running, onNavigate, onManage, onSelect, onOpenFolder, java, appVersion, onCheckUpdates, platform, account }) {
  const activeTasks = useTasks().filter((task) => task.status === 'downloading');
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

import { useState, useEffect } from 'react';
import {
  AlertCircle, Check, CheckCircle2, Download, FolderOpen, Gauge, HardDrive, Info, LoaderCircle, MemoryStick,
  RefreshCw, Trash2, UserRound, Zap, Palette, Users, LogIn, Rocket,
} from 'lucide-react';
import { Modal, Logo } from '../components/chrome';
import { THEMES } from '../constants';

export function SettingsPage({ settings, dataRoot, appVersion, platform, onCheckUpdates, onSave, onChooseJava, onChooseDirectory, onDetectJava, java, setJava, onOpenRoot, toast, accounts, currentAccountId, refreshAccounts }) {
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
  const submitAuth = async () => {
    if (authBusy) return;
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
  };
  return <div className="page settings-page">
    <div className="settings-layout"><div className="settings-main">
      <section className="settings-section"><div className="settings-title"><UserRound size={19} /><div><h2>玩家设置</h2><p>用于离线模式的游戏内显示名称</p></div></div><label className="field horizontal"><span>玩家名称</span><div><input value={form.username} maxLength={16} onChange={(e) => update('username', e.target.value)} /><small>建议使用 3–16 个字母、数字或下划线</small></div></label><div className="toggle-row"><div><strong>游戏语言自动设为简体中文</strong><span>每次启动前自动写入语言设置，新实例第一次进入游戏即为中文界面</span></div><button className={`switch ${form.autoChineseLang !== false ? 'on' : ''}`} onClick={async () => { update('autoChineseLang', form.autoChineseLang === false); try { await onSave({ ...form, autoChineseLang: form.autoChineseLang === false }); } catch {} }}><i /></button></div></section>
      <section className="settings-section"><div className="settings-title"><Users size={19} /><div><h2>游戏账户</h2><p>离线账户或皮肤站账户（Yggdrasil 外置登录，进在线服务器时验证身份）</p></div><button className="section-action" onClick={() => setAccountModal(true)}><LogIn size={12} />添加账户</button></div>
        <div className="account-list">{accounts.map((item) => <div key={item.id} className={`account-row ${item.id === currentAccountId ? 'current' : ''}`} onClick={() => window.hcl.selectAccount(item.id).then(refreshAccounts).catch((e) => toast(e.message, 'error'))}><div className="mini-avatar">{item.name.slice(0, 1).toUpperCase()}<i /></div><div className="account-info"><strong>{item.name}</strong><span>{item.type === 'yggdrasil' ? (() => { try { return new URL(item.apiRoot).hostname; } catch { return '外置登录'; } })() : '离线模式'}</span></div>{item.id === currentAccountId && <span className="current-check"><CheckCircle2 size={15} />当前</span>}<button className="account-remove" title="删除账户" onClick={(e) => { e.stopPropagation(); window.hcl.removeAccount(item.id).then(refreshAccounts).catch((err) => toast(err.message, 'error')); }}><Trash2 size={14} /></button></div>)}
          {!accounts.length && <div className="forge-loading">还没有账户，点击右上角「添加账户」创建</div>}
        </div></section>
      <section className="settings-section"><div className="settings-title"><Palette size={19} /><div><h2>外观主题</h2><p>选择启动器的强调色，点击立即生效并保存</p></div></div><div className="theme-grid">{THEMES.map((theme) => <button key={theme.id} className={`theme-card ${form.theme === theme.id ? 'selected' : ''}`} onClick={() => applyTheme(theme.id)}><span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${theme.c1}, ${theme.c2})` }} /><span>{theme.name}{form.theme === theme.id && <Check size={13} />}</span></button>)}</div></section>
      <section className="settings-section"><div className="settings-title"><Zap size={19} /><div><h2>Java 环境</h2><p>启动 Minecraft 所需的 Java 运行环境</p></div></div><div className="java-status"><div className={`java-status-icon ${java?.found ? 'ok' : ''}`}>{java?.found ? <Check size={20} /> : <AlertCircle size={20} />}</div><div><strong>{java?.found ? `已检测到 Java ${java.version}` : '未检测到可用的 Java'}</strong><span>{java?.found ? java.path : '1.20.5 及以上需要 Java 21，1.17–1.20.4 需要 Java 17，1.16.5 及以下需要 Java 8'}</span></div><div className="java-actions">{!java?.found && <a className="button secondary small" href="https://adoptium.net/temurin/releases/?version=21" target="_blank" rel="noreferrer"><Download size={14} />获取 Java 21</a>}<button className="button secondary small" onClick={async () => { setJava(null); setJava(await onDetectJava()); }}><RefreshCw size={14} />重新检测</button></div></div><label className="field horizontal"><span>Java 路径</span><div className="path-input"><input value={form.javaPath} onChange={(e) => update('javaPath', e.target.value)} placeholder="留空以自动检测 java.exe" /><button className="button secondary small" onClick={async () => { const file = await onChooseJava(); if (file) update('javaPath', file); }}>浏览</button></div></label><div className="field horizontal"><span>游戏内存</span><div className="memory-control"><div><MemoryStick size={16} /><input type="range" min="1024" max="16384" step="512" value={form.memory} onChange={(e) => update('memory', Number(e.target.value))} /><strong>{(form.memory / 1024).toFixed(1)} GB</strong></div><small>通常分配 4 GB 即可；大型 Mod 整合包可适当增加</small></div></div><div className="toggle-row"><div><strong>自动下载缺失的 Java</strong><span>启动时自动匹配游戏版本所需的 Java（8/17/21），缺失时从 Adoptium 下载安装到启动器数据目录（国内走清华镜像）</span></div><button className={`switch ${form.autoDownloadJava !== false ? 'on' : ''}`} onClick={async () => { const next = form.autoDownloadJava === false; update('autoDownloadJava', next); try { await onSave({ ...form, autoDownloadJava: next }); } catch {} }}><i /></button></div></section>
      <section className="settings-section"><div className="settings-title"><HardDrive size={19} /><div><h2>存储位置</h2><p>游戏实例、Mod 和光影的保存目录</p></div></div><label className="field horizontal"><span>游戏目录</span><div className="path-input"><input value={form.gameDirectory} onChange={(e) => update('gameDirectory', e.target.value)} /><button className="button secondary small" onClick={async () => { const folder = await onChooseDirectory(); if (folder) update('gameDirectory', folder); }}>浏览</button></div></label><div className="storage-note"><Info size={15} /><span>配置与缓存目录：{dataRoot}</span><button onClick={onOpenRoot}><FolderOpen size={14} />打开</button></div></section>
      <section className="settings-section"><div className="settings-title"><Rocket size={19} /><div><h2>启动器更新</h2><p>自动检查新版本并在后台下载，重启后即可完成安装</p></div></div><div className="toggle-row"><div><strong>自动检查并下载更新</strong><span>开启后，启动时和运行中每 2 小时各检查一次；关闭后仍可在右侧关于卡片手动检查</span></div><button className={`switch ${form.autoUpdate !== false ? 'on' : ''}`} onClick={async () => { const next = form.autoUpdate === false; update('autoUpdate', next); try { await onSave({ ...form, autoUpdate: next }); } catch {} }}><i /></button></div></section>
      <section className="settings-section"><div className="settings-title"><Gauge size={19} /><div><h2>启动加速</h2><p>启动游戏前自动整理系统内存，为游戏腾出更多可用空间</p></div><button className="section-action" onClick={async () => { const mb = await window.hcl.optimizeMemory(); toast(mb > 0 ? `内存优化完成，已释放 ${mb} MB 可用空间` : '本次未释放内存（系统可用内存充足或权限受限）', mb > 0 ? 'success' : 'info'); }}><Zap size={12} />立即优化</button></div><div className="toggle-row"><div><strong>启动前自动优化内存</strong><span>启动游戏前压缩各进程内存占用（Windows），实测可释放数百 MB 到数 GB；系统可用内存充足（3 GB 以上）时自动跳过</span></div><button className={`switch ${form.memoryOptimize !== false ? 'on' : ''}`} onClick={async () => { const next = form.memoryOptimize === false; update('memoryOptimize', next); try { await onSave({ ...form, memoryOptimize: next }); } catch {} }}><i /></button></div></section>
      <button className="button primary save-settings" disabled={saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}保存设置</button>
      {accountModal && <Modal title="添加游戏账户" subtitle="离线账户或皮肤站账户（Yggdrasil 外置登录）" onClose={() => setAccountModal(false)}>
        <div className="modal-body">
          <div className="account-form">
            <div className="segmented">{[['offline', '离线模式'], ['yggdrasil', '皮肤站账户']].map(([id, label]) => <button key={id} type="button" className={authType === id ? 'active' : ''} onClick={() => setAuthType(id)}>{label}</button>)}</div>
            <form onSubmit={(e) => { e.preventDefault(); submitAuth(); }}>
              {authType === 'offline' ? <label className="field"><span>玩家名称</span><input value={offlineName} maxLength={16} placeholder="3–16 位字母、数字或下划线" autoComplete="off" onChange={(e) => setOfflineName(e.target.value)} /></label>
              : <>
                <label className="field"><span>认证服务器</span><select value={customPreset} onChange={(e) => setCustomPreset(e.target.value)}><option value="littleskin">LittleSkin（littleskin.cn）</option><option value="custom">自定义 Yggdrasil 服务器…</option></select></label>
                {customPreset === 'custom' && <label className="field"><span>API 根地址</span><input value={customRoot} placeholder="https://example.com/api/yggdrasil" autoComplete="off" onChange={(e) => setCustomRoot(e.target.value)} /></label>}
                <label className="field"><span>账号（邮箱 / 用户名）</span><input value={authUser} autoComplete="username" onChange={(e) => setAuthUser(e.target.value)} /></label>
                <label className="field"><span>密码</span><input type="password" value={authPass} autoComplete="current-password" onChange={(e) => setAuthPass(e.target.value)} /></label>
                <p className="net-note">使用皮肤站账号进入开启外置登录的在线服务器；尚未注册？先到 littleskin.cn 注册并创建角色。密码仅用于向认证服务器登录，不会保存在本机。</p>
              </>}
              <button type="submit" className="hidden" disabled={authBusy} />
            </form>
          </div>
        </div>
        <footer className="modal-footer">
          <span className="modal-hint">{authBusy ? '正在连接认证服务器…' : '回车或点击按钮提交'}</span>
          <button className="button primary" disabled={authBusy} onClick={submitAuth}>{authBusy ? <LoaderCircle className="spin" size={17} /> : authType === 'offline' ? '创建离线账户' : '登录'}</button>
        </footer>
      </Modal>}
    </div><aside className="settings-aside"><div className="about-card"><Logo /><div className="about-version"><span>版本 {appVersion || '—'}</span><span>{platform === 'darwin' ? 'macOS' : 'Windows'}</span><button className="check-update" onClick={onCheckUpdates}><RefreshCw size={12} />检查更新</button></div><p>一个简单、清爽的 Minecraft 启动器。专注于游戏与社区内容，不做多余的事情。</p><div className="about-features"><span><Check size={14} />官方游戏版本</span><span><Check size={14} />Modrinth 资源</span><span><Check size={14} />本地实例管理</span></div></div><div className="legal-note">Minecraft 是 Mojang Synergies AB 的商标。HCL 不是官方 Minecraft 产品，与 Mojang 或 Microsoft 无隶属关系。</div></aside></div>
  </div>;
}

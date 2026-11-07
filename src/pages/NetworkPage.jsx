import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, Download, LoaderCircle, X, Network, Users, Globe, Copy, LogIn,
} from 'lucide-react';

export function NetworkPage({ toast, settings }) {
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

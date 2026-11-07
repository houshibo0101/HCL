import {
  Box, CheckCircle2, Coffee, Download, Package, RefreshCw, Sparkles, X, XCircle, FileText,
  Rocket,
} from 'lucide-react';
import { formatBytes } from '../lib/format';
import { EmptyState, IconButton } from '../components/chrome';
import { useTasks } from '../lib/task-store';

export function DownloadsPage({ onCancel, onClear, onOpenLog, onInstallUpdate }) {
  const tasks = useTasks();
  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  const active = sorted.filter((task) => task.status === 'downloading');
  return <div className="page downloads-page">
    <div className="download-summary"><div className="download-summary-icon"><Download size={25} /></div><div><strong>{active.length ? `${active.length} 个任务正在下载` : '下载队列很安静'}</strong><p>{active.length ? '可以离开此页面，下载会在后台继续。' : '安装游戏或下载 Mod、光影后，任务会显示在这里。'}</p></div>{sorted.length > 0 && <button className="button ghost small" onClick={onClear}>清除已完成</button>}</div>
    <div className="download-list">{sorted.map((task) => { const TaskIcon = { game: Box, shader: Sparkles, update: RefreshCw, java: Coffee }[task.kind] || Package; return <article className="download-task" key={task.id}><div className={`task-icon ${task.kind}`}><TaskIcon size={23} /></div><div className="task-body"><div className="task-heading"><div><strong>{task.title}</strong><span>{task.detail}</span></div><span className={`task-status ${task.status}`}>{task.status === 'downloading' ? `${Math.floor(task.progress)}%` : task.status === 'completed' ? <><CheckCircle2 size={15} />已完成</> : task.status === 'cancelled' ? '已取消' : <><XCircle size={15} />失败</>}</span></div><div className="progress-track"><i className={task.status} style={{ width: `${task.progress}%` }} /></div><div className="task-meta"><span>{task.total ? `${formatBytes(task.received)} / ${formatBytes(task.total)}` : task.kind === 'game' ? '正在准备游戏文件' : '正在连接资源服务器'}</span><time>{new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div></div>{task.status === 'downloading' && task.kind !== 'update' && <IconButton title="取消下载" onClick={() => onCancel(task.id)}><X size={17} /></IconButton>}
{task.kind === 'update' && task.status === 'completed' && <button className="button primary small" onClick={onInstallUpdate}><Rocket size={14} />重启安装</button>}
{task.status === 'error' && <button className="text-button log-open" onClick={onOpenLog}><FileText size={14} />失败日志</button>}</article>; })}{!sorted.length && <EmptyState icon={Download} title="还没有下载任务" text="去游戏版本、Mod 或光影页面找点喜欢的内容吧。" />}</div>
  </div>;
}

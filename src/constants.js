import { Box, Download, Home, Network, Package, Sparkles } from 'lucide-react';

export const THEMES = [
  { id: 'green', name: '翡翠绿', c1: '#83df90', c2: '#50b967' },
  { id: 'blue', name: '穹际蓝', c1: '#8ccbf7', c2: '#3d82d6' },
  { id: 'purple', name: '星辉紫', c1: '#c39bfa', c2: '#7e4fd6' },
  { id: 'orange', name: '暖阳橙', c1: '#f6bd7d', c2: '#e0762d' },
  { id: 'pink', name: '樱花粉', c1: '#fa92bd', c2: '#d64f86' },
  { id: 'teal', name: '薄荷青', c1: '#7fe8d9', c2: '#33a392' },
];

export const NAV_ITEMS = [
  { id: 'home', label: '首页', icon: Home },  { id: 'versions', label: '游戏版本', icon: Box },
  { id: 'mods', label: 'Mod 下载', icon: Package },
  { id: 'shaders', label: '光影下载', icon: Sparkles },
  { id: 'network', label: '联机', icon: Network },
  { id: 'downloads', label: '下载管理', icon: Download },
];
export const PAGE_META = {
  home: ['概览', '欢迎回到方块世界'], versions: ['游戏版本', '下载并创建新的游戏实例'],
  mods: ['Mod 下载', '发现社区创作的无限可能'], shaders: ['光影下载', '让世界焕然一新'],
  network: ['联机', '和朋友一起玩'], downloads: ['下载管理', '查看文件下载与安装进度'], settings: ['启动器设置', '管理游戏目录与运行环境'],
};
export const TYPE_LABELS = { release: '正式版', snapshot: '快照', old_beta: 'Beta', old_alpha: 'Alpha' };

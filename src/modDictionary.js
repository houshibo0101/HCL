// HCL 内置 Mod/光影中文映射表
// 用途：1) 中文搜索词 → Modrinth 英文关键词；2) 搜索结果展示中文名与中文简介
// 命中策略：slug 精确 > 名称精确 > 别名包含；未收录的资源保持英文原名显示
export const MOD_ENTRIES = [
  // ── 基础工具 ──
  { slug: 'jei', name: 'Just Enough Items (JEI)', zh: 'JEI 物品查询', aliases: ['jei', '物品查询', '物品管理', '配方查询'], desc: '查看所有物品的合成配方与用途，生存必备' },
  { slug: 'fabric-api', name: 'Fabric API', zh: 'Fabric 前置 API', aliases: ['fabric api', 'fabricapi', 'fabric前置'], desc: 'Fabric 模组的前置库，大部分 Fabric Mod 都需要' },
  { slug: 'cloth-config', name: 'Cloth Config API', zh: 'Cloth 配置库', aliases: ['cloth config', 'clothconfig'], desc: '模组配置界面的通用前置库' },
  { slug: 'modmenu', name: 'Mod Menu', zh: '模组菜单', aliases: ['mod menu', '模组列表', '模组菜单'], desc: '在游戏内查看和管理已安装模组' },
  { slug: 'appleskin', name: 'AppleSkin', zh: '苹果皮（饥饿显示）', aliases: ['appleskin', '苹果皮', '饱食度'], desc: '显示饱食度、饱和度与食物恢复量' },
  { slug: 'mouse-tweaks', name: 'Mouse Tweaks', zh: '鼠标增强', aliases: ['mouse tweaks', '鼠标增强'], desc: '用鼠标拖动快速整理物品栏' },
  { slug: 'jade', name: 'Jade 🔍', zh: 'Jade（方块信息查看）', aliases: ['jade', 'waila', '方块信息', '看方块'], desc: '看向方块/生物时显示名称与状态信息' },
  { slug: 'carry-on', name: 'Carry On', zh: '搬运 (Carry On)', aliases: ['carry on', 'carryon', '搬运', '搬箱子'], desc: '徒手搬起箱子、容器等方块到处走' },
  { slug: 'clumps', name: 'Clumps', zh: '经验球合并', aliases: ['clumps', '经验球'], desc: '合并经验球，减少卡顿' },
  { slug: 'waystones', name: 'Waystones', zh: '路标 (传送石碑)', aliases: ['waystones', '传送石碑', '路标'], desc: '放置路标实现多点传送网络' },
  { slug: 'fast-leaf-decay', name: 'Fast Leaf Decay', zh: '树叶快速掉落', aliases: ['fast leaf decay', '树叶掉落'], desc: '砍掉树干后树叶迅速消失' },

  // ── 地图与导航 ──
  { slug: 'xaeros-minimap', name: "Xaero's Minimap", zh: "Xaero 小地图", aliases: ['xaero minimap', 'xaeros minimap', '小地图'], desc: '轻量实用的小地图，支持路标与实体显示' },
  { slug: 'xaeros-world-map', name: "Xaero's World Map", zh: "Xaero 世界地图", aliases: ['xaero world map', '世界地图', '全屏地图'], desc: "与 Xaero 小地图配套的全屏世界地图" },
  { slug: 'journeymap', name: 'JourneyMap', zh: '旅行地图 (JourneyMap)', aliases: ['journeymap', '旅行地图'], desc: '老牌地图模组，实时地图+路径点' },
  { slug: 'distant-horizons', name: 'Distant Horizons', zh: '视距扩展 (远方地平线)', aliases: ['distant horizons', '远景', '视距扩展'], desc: '用 LOD 技术把可视距离扩展到数百格' },

  // ── 优化与性能 ──
  { slug: 'sodium', name: 'Sodium', zh: '钠 (Sodium 性能优化)', aliases: ['sodium', '钠', '性能优化'], desc: '大幅提升帧率的渲染优化引擎' },
  { slug: 'lithium', name: 'Lithium', zh: '锂 (Lithium 逻辑优化)', aliases: ['lithium', '锂'], desc: '优化游戏逻辑运算，不改变游戏行为' },
  { slug: 'iris', name: 'Iris Shaders', zh: 'Iris 光影加载器', aliases: ['iris', '光影加载器'], desc: 'Fabric 上加载光影包的首选，兼容 OptiFine 光影' },
  { slug: 'indium', name: 'Indium', zh: '铟 (Indium 渲染兼容)', aliases: ['indium', '铟'], desc: '让 Sodium 支持原有渲染 API 的兼容层' },
  { slug: 'sodium-extra', name: 'Sodium Extra', zh: '钠增强 (Sodium Extra)', aliases: ['sodium extra', '钠增强'], desc: '为 Sodium 补充更多视频设置选项' },
  { slug: 'reeses-sodium-options', name: "Reese's Sodium Options", zh: '视频设置增强', aliases: ['reeses sodium options', '视频设置'], desc: '更美观流畅的视频设置界面' },
  { slug: 'ferrite-core', name: 'Ferrite Core', zh: '铁芯（内存优化）', aliases: ['ferrite core', '内存优化'], desc: '降低内存占用' },
  { slug: 'starlight', name: 'Starlight (Forge)', zh: '星光（光照优化）', aliases: ['starlight', '光照优化', '星光'], desc: '重写光照引擎，大幅加快光照计算' },
  { slug: 'embeddium', name: 'Embeddium', zh: 'Embeddium 渲染优化', aliases: ['embeddium'], desc: 'Forge 平台的高性能渲染优化' },
  { slug: 'oculus', name: 'Oculus', zh: 'Oculus（Forge 光影）', aliases: ['oculus'], desc: 'Forge 平台的 Iris 分支，加载 OptiFine 光影' },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', zh: '即时渲染优化', aliases: ['immediatelyfast', '即时渲染'], desc: '优化即时渲染路径提升帧率' },
  { slug: 'entityculling', name: 'Entity Culling', zh: '实体剔除优化', aliases: ['entity culling', 'entityculling', '实体剔除'], desc: '不渲染被遮挡的实体，提升 FPS' },
  { slug: 'dynamic-fps', name: 'Dynamic FPS', zh: '动态帧率', aliases: ['dynamic fps', '动态帧率'], desc: '窗口失焦时自动降低帧率省资源' },

  // ── 科技与自动化 ──
  { slug: 'create', name: 'Create', zh: '机械动力 (Create)', aliases: ['create', '机械动力'], desc: '旋转传动与精巧机械，最具美感的科技模组' },
  { slug: 'mekanism', name: 'Mekanism', zh: '通用机械 (Mekanism)', aliases: ['mekanism', '通用机械'], desc: '大型工业科技模组，从采矿到聚变堆' },
  { slug: 'applied-energistics-2', name: 'Applied Energistics 2', zh: '应用能源2 (AE2)', aliases: ['applied energistics', 'ae2', '应用能源'], desc: '数字化存储与自动化合成的核心模组' },
  { slug: 'immersive-engineering', name: 'Immersive Engineering', zh: '沉浸工程', aliases: ['immersive engineering', '沉浸工程'], desc: '写实风格的电力工业模组' },
  { slug: 'industrial-foregoing', name: 'Industrial Foregoing', zh: '工业前卫', aliases: ['industrial foregoing', '工业前卫'], desc: '自动化机器合集：刷怪、挤奶、采矿' },
  { slug: 'minecolonies', name: 'MineColonies', zh: '殖民地 (MineColonies)', aliases: ['minecolonies', '殖民地'], desc: '建立NPC殖民地，自动建造与经营城镇' },

  // ── 魔法与冒险 ──
  { slug: 'botania', name: 'Botania', zh: '植物魔法 (Botania)', aliases: ['botania', '植物魔法'], desc: '以花朵为核心的自然魔法模组' },
  { slug: 'patchouli', name: 'Patchouli', zh: '帕秋莉手册 (Patchouli)', aliases: ['patchouli', '帕秋莉', '指南书'], desc: '模组内指南书框架，众多模组的前置' },
  { slug: 'twilight-forest', name: 'The Twilight Forest', zh: '暮色森林 (Twilight Forest)', aliases: ['twilight forest', '暮色森林'], desc: '经典探险维度：迷宫、Boss 与新装备' },
  { slug: 'tinkers-construct', name: "Tinkers' Construct", zh: '匠魂 (Tinkers Construct)', aliases: ['tinkers construct', '匠魂'], desc: '自己熔炼组装专属武器的工具模组' },
  { slug: 'ice-and-fire-dragons', name: 'Ice and Fire: Dragons', zh: '冰与火之歌：龙', aliases: ['ice and fire', '冰与火之歌', '龙'], desc: '加入冰火巨龙与神话生物' },
  { slug: 'epic-fight', name: 'Epic Fight', zh: '史诗战斗 (Epic Fight)', aliases: ['epic fight', '史诗战斗'], desc: '动作化战斗系统与华丽连招' },
  { slug: 'cobblemon', name: 'Cobblemon', zh: '宝可梦 (Cobblemon)', aliases: ['cobblemon', '宝可梦', ' pokemon', '神奇宝贝'], desc: '开源宝可梦模组，风格自然融入原版' },

  // ── 生活与装饰 ──
  { slug: 'farmers-delight', name: "Farmer's Delight", zh: '农夫乐事 (Farmer’s Delight)', aliases: ['farmer delight', 'farmers delight', '农夫乐事'], desc: '扩展农业与烹饪系统的美食模组' },
  { slug: 'chipped', name: 'Chipped', zh: 'Chipped 方块工坊', aliases: ['chipped', '方块工坊'], desc: '数百种方块变体，装饰玩家必备' },
  { slug: 'supplementaries', name: 'Supplementaries', zh: '补充 (Supplementaries)', aliases: ['supplementaries', '补充'], desc: '大量实用装饰方块与小道具' },
  { slug: 'security-craft', name: 'Security Craft', zh: '安全工艺 (SecurityCraft)', aliases: ['security craft', '安全工艺', '防盗'], desc: '密码门、监控、激光等安防方块' },
  { slug: 'serene-seasons', name: 'Serene Seasons', zh: '宁静四季', aliases: ['serene seasons', '四季'], desc: '加入春夏秋冬与季节性农作物' },

  // ── 世界生成 ──
  { slug: 'terralith', name: 'Terralith', zh: 'Terralith 世界生成', aliases: ['terralith', '地形生成'], desc: '近百个新群系的原版风格世界生成' },
  { slug: 'tectonic', name: 'Tectonic', zh: 'Tectonic 地形', aliases: ['tectonic'], desc: '更宏大真实的山脉与地形' },

  // ── 趣味与杂项 ──
  { slug: 'physics-mod', name: 'Physics Mod', zh: '物理模拟 (Physics Mod)', aliases: ['physics mod', '物理'], desc: '碎块、布料与真实物理效果' },
  { slug: 'notenoughanimations', name: 'Not Enough Animations', zh: '更多动画', aliases: ['not enough animations', '更多动画'], desc: '补全第三人称动作细节动画' },
];

// ── 光影（shader 类目）──
export const SHADER_ENTRIES = [
  { slug: 'complementary-reimagined', name: 'Complementary Reimagined', zh: '互补重制 (Complementary Reimagined)', aliases: ['complementary reimagined', '互补重制'], desc: '原版风格增强光影，性能均衡' },
  { slug: 'complementary-unbound', name: 'Complementary Unbound', zh: '互补无界 (Complementary Unbound)', aliases: ['complementary unbound', '互补无界', 'complementary'], desc: 'Complementary 系列最新版本' },
  { slug: 'bsl-shaders', name: 'BSL Shaders', zh: 'BSL 光影', aliases: ['bsl', 'bsl shaders'], desc: '经典老牌光影，画面柔和稳定' },
  { slug: 'photon', name: 'Photon', zh: 'Photon 光影', aliases: ['photon', '光子'], desc: '原版风格光影，色彩清新' },
  { slug: 'makeup-ultra-fast-shaders', name: 'MakeUp - Ultra Fast', zh: '超快光影 (MakeUp Ultra Fast)', aliases: ['makeup', 'ultra fast', '低配光影'], desc: '低配机器也能流畅运行的光影' },
  { slug: 'bliss-shader', name: 'Bliss', zh: 'Bliss 光影', aliases: ['bliss'], desc: 'Chocapic 系现代分支，画质出色' },
];

// ── 通用类别词（中文 → 英文关键词）──
export const CATEGORY_WORDS = [
  ['科技', 'technology'], ['工业', 'technology'], ['自动化', 'automation'],
  ['魔法', 'magic'], ['冒险', 'adventure'], ['探索', 'adventure'],
  ['装饰', 'decoration'], ['建筑', 'building'], ['家具', 'furniture'],
  ['存储', 'storage'], ['食物', 'food'], ['农业', 'farming'], ['种植', 'farming'],
  ['工具', 'utility'], ['实用', 'utility'], ['优化', 'optimization'], ['性能', 'optimization'],
  ['光影', 'shader'], ['小地图', 'minimap'], ['地图', 'map'],
  ['背包', 'backpack'], ['世界生成', 'worldgen'], ['地形', 'worldgen'],
  ['生物', 'mobs'], ['怪物', 'mobs'], ['boss', 'boss'], ['Boss', 'boss'],
];

const normalize = (s) => String(s || '').trim().toLowerCase();

// 把中文查询翻译成 Modrinth 可命中的英文关键词；无法翻译时返回 null（原样搜索）
export function translateQuery(raw) {
  const q = normalize(raw);
  if (!q) return null;
  const entries = MOD_ENTRIES.filter((e) => !e.hidden).concat(SHADER_ENTRIES.filter((e) => !e.hidden));
  // 1) 完全等于某个别名 → 直接用该资源的英文名
  for (const entry of entries) {
    for (const alias of entry.aliases || []) {
      if (q === normalize(alias)) return { keyword: entry.name, entry, exact: true };
    }
  }
  // 2) 完全等于类别词 → 用通用英文关键词
  for (const [alias, keyword] of CATEGORY_WORDS) {
    if (q === normalize(alias)) return { keyword, category: true };
  }
  // 3) 查询包含别名（如“小地图mod”）→ 仍然翻译
  const contains = entries
    .flatMap((entry) => (entry.aliases || []).map((alias) => ({ entry, alias })))
    .filter(({ alias }) => normalize(alias).length >= 2 && q.includes(normalize(alias)))
    .sort((a, b) => normalize(b.alias).length - normalize(a.alias).length)[0];
  if (contains) return { keyword: contains.entry.name, entry: contains.entry };
  return null;
}

// 给某个 Modrinth 项目找中文映射（slug 优先，名称兜底）
export function lookupProject(project) {
  if (!project) return null;
  const entries = MOD_ENTRIES.filter((e) => !e.hidden).concat(SHADER_ENTRIES.filter((e) => !e.hidden));
  return (
    entries.find((e) => e.slug && project.slug && e.slug === project.slug) ||
    entries.find((e) => normalize(e.name) === normalize(project.title))
  ) || null;
}

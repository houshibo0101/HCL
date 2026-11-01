const fs = require('fs');
const pages = ['Home', 'Installation', 'Usage', 'FAQ', 'Development'];
const conv = (t) => t
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, text, page) => `[${text}](${page}.md)`)
  .replace(/\[\[([^\]|]+)\]\]/g, (m, page) => `[${page}](${page}.md)`)
  .replace(/https:\/\/github\.com\/houshibo0101\/HCL\/wiki\/([A-Za-z_]+)/g, (m, page) => `${page}.md`);
for (const p of pages) {
  let t = fs.readFileSync(`wiki/${p}.md`, 'utf8');
  t = conv(t);
  if (p === 'Home') {
    t = t.replace('# HCL 启动器\n', '# HCL 启动器文档\n\n![HCL 主界面](preview.png)\n');
    const toc = '\n## 文档目录\n\n| 页面 | 内容 |\n| --- | --- |\n| [安装指南](Installation.md) | 系统要求、安装步骤、Java 自动下载、数据目录 |\n| [使用指南](Usage.md) | 版本安装、Mod/光影、账户、联机、设置详解 |\n| [常见问题](FAQ.md) | 更新、Java、联机、下载失败排查 |\n| [开发与构建](Development.md) | 环境搭建、项目结构、发布流程 |\n';
    t = t.replace('\n## 文档导航\n', toc + '\n## 详细文档\n');
  }
  fs.writeFileSync(`docs/${p === 'Home' ? 'index' : p}.md`, t);
  if (p === 'Home') fs.writeFileSync('docs/Home.md', conv(fs.readFileSync('wiki/Home.md', 'utf8')));
  console.log(`docs/${p === 'Home' ? 'index' : p}.md written`);
}

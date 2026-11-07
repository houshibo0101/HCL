import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 生产构建注入 CSP：只允许本地资源与 https 图片，禁止远程/内联脚本。
// 开发模式不注入，避免挡掉 Vite 的 HMR websocket 与内联样式。
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const injectCsp = () => ({
  name: 'hcl-inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />\n  </head>`);
  },
});

export default defineConfig({
  plugins: [react(), injectCsp()],
  base: './',
  server: {
    // 只关心渲染层源码：electron/ 与构建产物里的临时文件会干扰文件监听
    watch: { ignored: ['**/electron/**', '**/release/**', '**/data/**', '**/dist/**', '**/.*.tmpdir/**'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

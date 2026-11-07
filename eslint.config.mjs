export default [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'node_modules-incomplete/**', 'data/**'],
  },
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', __dirname: 'readonly', __filename: 'readonly',
        process: 'readonly', console: 'readonly', Buffer: 'readonly', fetch: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly', ReadableStream: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-unused-vars': ['warn', { args: 'none' }],
    },
  },
  {
    // 渲染层：React 组件是 .jsx，必须显式打开 JSX 语法才会被 lint 到
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Intl: 'readonly', AbortController: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      // 组件/图标名在 JSX 里的引用核心规则认不出来，跳过首字母大写的标识符避免误报
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^[A-Z]' }],
    },
  },
];

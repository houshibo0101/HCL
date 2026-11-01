export default [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**'],
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
    files: ['src/**'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        fetch: 'readonly',
      },
    },
  },
];

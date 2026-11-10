import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeBuiltins = [
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'readline',
  'stream',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

const nodeImportPatterns = [
  {
    group: ['node:*'],
    message: 'Node built-ins are not allowed in this layer.',
  },
  ...nodeBuiltins.map((name) => ({
    group: [name, `${name}/*`],
    message: 'Node built-ins are not allowed in this layer.',
  })),
];

const upwardLayerPatterns = (names) =>
  names.flatMap((name) => [
    {
      group: [`@game/${name}`, `@game/${name}/*`],
      message: `This layer must not import from ${name}.`,
    },
    {
      group: [`**/packages/${name}/**`, `**/${name}/src/**`],
      message: `This layer must not import from ${name}.`,
    },
  ]);

const domGlobalNames = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'alert',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'HTMLElement',
  'Element',
  'Node',
  'Worker',
  'self',
];
const nodeGlobalNames = [
  'process',
  'Buffer',
  'require',
  '__dirname',
  '__filename',
  'global',
];
const restrictedGlobals = (names, what) =>
  names.map((name) => ({
    name,
    message: `${what} globals are not allowed in this layer.`,
  }));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...upwardLayerPatterns(['web', 'session']),
            ...nodeImportPatterns,
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...restrictedGlobals(domGlobalNames, 'Browser/DOM'),
        ...restrictedGlobals(nodeGlobalNames, 'Node'),
      ],
    },
  },
  {
    files: ['packages/session/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: upwardLayerPatterns(['web']) },
      ],
      'no-restricted-globals': [
        'error',
        ...restrictedGlobals(domGlobalNames, 'Browser/DOM'),
      ],
    },
  },
);

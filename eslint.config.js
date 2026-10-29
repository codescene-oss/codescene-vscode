const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: ['out/**', 'dist/**', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: ['objectLiteralProperty', 'objectLiteralMethod'],
          format: null,
        },
        {
          selector: ['typeProperty'],
          format: null,
        },
        {
          selector: ['import'],
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: ['default'],
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: ['parameter'],
          format: ['camelCase'],
          leadingUnderscore: 'allowDouble',
          filter: {
            regex: '^_+$',
            match: false,
          },
        },
        {
          selector: ['parameter'],
          format: null,
          filter: {
            regex: '^_+$',
            match: true,
          },
        },
        {
          selector: ['typeLike'],
          format: ['PascalCase'],
        },
        {
          selector: ['classProperty'],
          modifiers: ['static', 'readonly'],
          format: ['UPPER_CASE', 'camelCase'],
        },
        {
          selector: ['classProperty'],
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: ['parameterProperty'],
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: ['variable'],
          modifiers: ['const', 'global'],
          format: ['UPPER_CASE', 'camelCase'],
        },
        {
          selector: ['variable'],
          modifiers: ['global'],
          format: ['UPPER_CASE', 'camelCase'],
        },
      ],
      '@typescript-eslint/no-floating-promises': ['warn'],
      curly: ['warn', 'multi-line'],
      eqeqeq: 'warn',
      'no-eval': 'error',
      'no-throw-literal': 'warn',
      semi: 'warn',
      'max-classes-per-file': ['warn', 1],
      'no-duplicate-imports': 'error',
    },
  },
];

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true }],
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['react', 'react/**', 'react-native', 'react-native/**', 'expo*', 'expo*/**'],
          message: 'Shared domain code must not depend on React, React Native or Expo.',
        }],
      }],
      'no-restricted-syntax': ['error',
        {
          selector: "MemberExpression[object.name='Date'][property.name='now'], MemberExpression[object.name='Date'][property.value='now']",
          message: 'Pass now as an argument instead of reading the clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Construct Date with an explicit instant.',
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: 'Pass an explicit instant instead of calling the host clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length>=2]",
          message: 'Use Date.UTC instead of constructing a host-local date.',
        },
        {
          selector: "MemberExpression[property.name=/^(toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString)$/], MemberExpression[property.value=/^(toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString)$/]",
          message: 'Use explicit-zone Intl formatting in time.ts instead of host-local formatting.',
        },
        {
          selector: "MemberExpression[property.name=/^(getDate|getDay|getFullYear|getHours|getMilliseconds|getMinutes|getMonth|getSeconds|getTimezoneOffset|getYear|setDate|setFullYear|setHours|setMilliseconds|setMinutes|setMonth|setSeconds|setYear)$/], MemberExpression[property.value=/^(getDate|getDay|getFullYear|getHours|getMilliseconds|getMinutes|getMonth|getSeconds|getTimezoneOffset|getYear|setDate|setFullYear|setHours|setMilliseconds|setMinutes|setMonth|setSeconds|setYear)$/]",
          message: 'Use UTC Date methods instead of host-local time.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random'], MemberExpression[object.name='Math'][property.value='random']",
          message: 'Pass deterministic inputs instead of reading global randomness.',
        },
      ],
    },
  },
];

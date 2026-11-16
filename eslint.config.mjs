import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'mobile/**/*', 'supabase/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];

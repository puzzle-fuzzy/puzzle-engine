import antfu from '@antfu/eslint-config'

export default antfu({
  react: true,
  typescript: true,
  rules: {
    'no-console': 'off',
  },
  ignores: [
    'dist',
    'build',
    'node_modules',
    'docs',
    '**/dist',
  ],
})

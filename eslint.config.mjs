import tseslint from 'typescript-eslint'

export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**', 'infra/**', 'observability/**', 'coverage/**'] },
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        extends: [tseslint.configs.recommended],
    },
)

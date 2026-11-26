module.exports = {
    forbidden: [
        {
            name: 'controllers-only-from-app-module',
            severity: 'error',
            from: { path: '^src/', pathNot: '^src/app\\.module\\.ts$' },
            to: { path: '^src/(controllers|gateways)/' },
        },
        {
            name: 'entities-stay-plain',
            severity: 'error',
            from: { path: '^src/entities/' },
            to: { path: '^src/', pathNot: '^src/entities/' },
        },
        {
            name: 'observability-knows-no-domain',
            severity: 'error',
            from: { path: '^src/observability/' },
            to: { path: '^src/', pathNot: '^src/observability/' },
        },
        {
            name: 'no-demo-in-production-code',
            severity: 'error',
            from: { path: '^src/', pathNot: '^src/demo/' },
            to: { path: '^src/demo/' },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        tsConfig: { fileName: 'tsconfig.json' },
        tsPreCompilationDeps: true,
    },
}

module.exports = {
    testEnvironment: 'node',
    rootDir: 'dist/test',
    testMatch: ['**/*.spec.js'],
    setupFiles: ['<rootDir>/setup-env.js'],
    reporters: ['default'],
    maxWorkers: 1,
    testTimeout: 120000,
}

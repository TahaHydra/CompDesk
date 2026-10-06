/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
        // Shared ESM modules in scripts/ (used by both the application and the first-run setup).
        '^.+[\\\\/]scripts[\\\\/].+\\.mjs$': '<rootDir>/scripts/jest-mjs-transform.cjs',
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
    modulePathIgnorePatterns: ['<rootDir>/.next/'],
    collectCoverageFrom: ['src/lib/**/*.ts'],
};

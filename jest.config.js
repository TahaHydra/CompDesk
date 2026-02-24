/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
    modulePathIgnorePatterns: ['<rootDir>/.next/'],
    collectCoverageFrom: ['src/lib/**/*.ts'],
};

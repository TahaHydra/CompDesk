import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

it('excludes the CSS compiler and its glob parser from production installs', () => {
    for (const name of ['tailwindcss', 'tailwindcss-animate']) {
        expect(manifest.dependencies[name]).toBeUndefined();
        expect(manifest.devDependencies[name]).toBeDefined();
    }
    for (const name of ['tailwindcss', 'tailwindcss-animate', 'braces', 'micromatch']) {
        expect(lock.packages[`node_modules/${name}`].dev).toBe(true);
    }
});

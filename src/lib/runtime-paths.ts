import path from 'path';

export function isLocalStandaloneRuntime(cwd = process.cwd()): boolean {
    return path.basename(cwd).toLowerCase() === 'standalone'
        && path.basename(path.dirname(cwd)).toLowerCase() === '.next';
}

export function resolveApplicationRoot(cwd = process.cwd()): string {
    return isLocalStandaloneRuntime(cwd)
        ? path.resolve(cwd, '..', '..')
        : path.resolve(cwd);
}

export function resolveRuntimeEnvFiles(cwd = process.cwd()): string[] {
    const applicationEnv = path.join(resolveApplicationRoot(cwd), '.env');
    const runtimeEnv = path.join(path.resolve(cwd), '.env');
    return [...new Set([applicationEnv, runtimeEnv])];
}

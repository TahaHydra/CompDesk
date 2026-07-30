import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

let serverProcess: ChildProcess;
let setupOrigin: string;
let bootstrapToken: string;
let stateDirectory: string;
let processOutput = '';

async function availablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No setup test port')));
        });
    });
}

async function waitForOutput(pattern: RegExp, timeoutMs = 20_000): Promise<RegExpMatchArray> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            clearInterval(interval);
            reject(new Error(`Process did not become ready: ${processOutput}`));
        }, timeoutMs);
        const interval = setInterval(() => {
            const match = processOutput.match(pattern);
            if (match) {
                clearTimeout(timeout);
                clearInterval(interval);
                resolve(match);
            } else if (serverProcess.exitCode !== null) {
                clearTimeout(timeout);
                clearInterval(interval);
                reject(new Error(`Process exited early: ${processOutput}`));
            }
        }, 25);
    });
}

function observeProcess(child: ChildProcess): void {
    processOutput = '';
    child.stdout?.on('data', (chunk) => { processOutput += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { processOutput += chunk.toString(); });
}

async function startSetup(): Promise<void> {
    const port = await availablePort();
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-playwright-setup-'));
    setupOrigin = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'setup-bootstrap.mjs')], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            SETUP_PORT: String(port),
            SETUP_HOST: '127.0.0.1',
            SETUP_ALLOW_REMOTE: 'false',
            COMPDESK_SETUP_STATE_DIR: stateDirectory,
            COMPDESK_ENV_FILE: path.join(stateDirectory, 'compdesk.env'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    observeProcess(serverProcess);
    bootstrapToken = (await waitForOutput(/bootstrap token[^:]*:\s*(\S+)/i))[1];
}

async function stopServer(): Promise<void> {
    if (serverProcess?.exitCode === null) {
        serverProcess.kill('SIGTERM');
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => { serverProcess.kill('SIGKILL'); resolve(); }, 3_000);
            serverProcess.once('exit', () => { clearTimeout(timeout); resolve(); });
        });
    }
}

function readGeneratedEnvironment(file: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        const key = line.slice(0, separator);
        const rawValue = line.slice(separator + 1);
        result[key] = rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue;
    }
    return result;
}

async function startApplication(): Promise<void> {
    await stopServer();
    const generated = readGeneratedEnvironment(path.join(stateDirectory, 'compdesk.env'));
    const port = new URL(setupOrigin).port;
    serverProcess = spawn(process.execPath, [path.join(process.cwd(), '.next', 'standalone', 'server.js')], {
        cwd: process.cwd(),
        env: { ...process.env, ...generated, PORT: port, HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    observeProcess(serverProcess);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (serverProcess.exitCode !== null) throw new Error(`Application exited early: ${processOutput}`);
        try {
            const response = await fetch(`${setupOrigin}/auth/signin`, { redirect: 'manual' });
            if (response.status < 500) return;
        } catch { /* retry until the server binds */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Application did not start: ${processOutput}`);
}

test.beforeAll(startSetup);
test.afterAll(async () => {
    await stopServer();
    if (stateDirectory) fs.rmSync(stateDirectory, { recursive: true, force: true });
});

test('completes a clean installation and permanently retires setup', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!process.env.E2E_DATABASE_URL, 'E2E_DATABASE_URL is required for the complete installer test.');
    const databaseUrl = new URL(process.env.E2E_DATABASE_URL!);
    const adminEmail = `release-admin-${Date.now()}@example.test`;

    await page.goto(`${setupOrigin}/dashboard`);
    await expect(page).toHaveURL(`${setupOrigin}/setup`);
    await expect(page.getByRole('heading', { name: 'First-run setup' })).toBeVisible();

    await page.getByLabel('Bootstrap token').fill(bootstrapToken);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: '1. Welcome and system check' })).toBeVisible();
    expect(page.url()).not.toContain(bootstrapToken);

    await page.getByText('Existing PostgreSQL with standalone Node.js', { exact: true }).click();
    await page.locator('input[name="dbHost"]').fill(databaseUrl.hostname);
    await page.locator('input[name="dbPort"]').fill(databaseUrl.port || '5432');
    await page.locator('input[name="dbName"]').fill(decodeURIComponent(databaseUrl.pathname.slice(1)));
    await page.locator('input[name="dbUser"]').fill(decodeURIComponent(databaseUrl.username));
    await page.locator('input[name="dbPassword"]').fill(decodeURIComponent(databaseUrl.password));
    await page.locator('select[name="dbSslMode"]').selectOption(databaseUrl.searchParams.get('sslmode') || 'disable');
    await page.locator('input[name="applicationUrl"]').fill(setupOrigin);
    await page.locator('input[name="adminName"]').fill('Release Administrator');
    await page.locator('input[name="adminEmail"]').fill(adminEmail);
    await page.locator('input[name="adminPassword"]').fill('ReleaseCandidate1!Secure');
    await page.locator('input[name="adminPasswordConfirm"]').fill('ReleaseCandidate1!Secure');
    await page.locator('input[name="privateAttachmentDir"]').fill(path.join(stateDirectory, 'attachments'));

    for (let step = 0; step < 9; step += 1) {
        await page.getByRole('button', { name: 'Next' }).click();
        await expect(page.getByText(`Step ${step + 2} of 10`)).toBeVisible();
    }
    await page.getByLabel(/authorize migrations and installation/i).check();
    const installResponse = page.waitForResponse((response) => response.url().endsWith('/setup/api/install'));
    await page.getByRole('button', { name: 'Install CompDesk' }).click();
    expect((await installResponse).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Installation complete' })).toBeVisible({ timeout: 60_000 });

    const retired = await page.request.get(`${setupOrigin}/setup`);
    expect(retired.status()).toBe(410);
    const retiredApi = await page.request.get(`${setupOrigin}/setup/api/state`);
    expect(retiredApi.status()).toBe(410);

    await startApplication();
    await page.goto(`${setupOrigin}/auth/signin`);
    await expect(page).toHaveURL(/\/auth\/signin/);
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
});
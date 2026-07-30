import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

let setupProcess: ChildProcess;
let setupOrigin: string;
let bootstrapToken: string;
let stateDirectory: string;

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

async function startSetup(): Promise<void> {
    const port = await availablePort();
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-playwright-setup-'));
    setupOrigin = `http://127.0.0.1:${port}`;
    setupProcess = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'setup-bootstrap.mjs')], {
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
    let output = '';
    setupProcess.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    setupProcess.stderr?.on('data', (chunk) => { output += chunk.toString(); });
    bootstrapToken = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Setup server did not start: ${output}`)), 15_000);
        const interval = setInterval(() => {
            const match = output.match(/bootstrap token[^:]*:\s*(\S+)/i);
            if (match) {
                clearTimeout(timeout);
                clearInterval(interval);
                resolve(match[1]);
            } else if (setupProcess.exitCode !== null) {
                clearTimeout(timeout);
                clearInterval(interval);
                reject(new Error(`Setup server exited early: ${output}`));
            }
        }, 25);
    });
}

async function stopSetup(): Promise<void> {
    if (setupProcess?.exitCode === null) {
        setupProcess.kill('SIGTERM');
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => { setupProcess.kill('SIGKILL'); resolve(); }, 3_000);
            setupProcess.once('exit', () => { clearTimeout(timeout); resolve(); });
        });
    }
    if (stateDirectory) fs.rmSync(stateDirectory, { recursive: true, force: true });
}

test.beforeAll(startSetup);
test.afterAll(stopSetup);

test('first-run setup requires the one-time token and opens the resumable wizard safely', async ({ page }) => {
    await page.goto(`${setupOrigin}/dashboard`);
    await expect(page).toHaveURL(`${setupOrigin}/setup`);
    await expect(page.getByRole('heading', { name: 'First-run setup' })).toBeVisible();
    expect(await page.locator('#authorize').evaluate((element) => typeof (element as HTMLButtonElement).onclick)).toBe('function');

    await page.getByLabel('Bootstrap token').fill('wrong-token');
    const rejectedSession = page.waitForResponse((response) => response.url().endsWith('/setup/api/session'));
    await page.getByRole('button', { name: 'Continue' }).click();
    expect((await rejectedSession).status()).toBe(401);
    await expect(page.getByText(/Invalid bootstrap token/)).toBeVisible();

    await page.getByLabel('Bootstrap token').fill(bootstrapToken);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: '1. Welcome and system check' })).toBeVisible();
    await expect(page).toHaveURL(`${setupOrigin}/setup`);
    expect(page.url()).not.toContain(bootstrapToken);
    await expect(page.getByText('Step 1 of 10')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();

    const readiness = await page.request.get(`${setupOrigin}/api/health/ready`);
    expect(readiness.status()).toBe(503);
    await expect(readiness.json()).resolves.toEqual({ status: 'not_ready', reason: 'installation_incomplete' });
});
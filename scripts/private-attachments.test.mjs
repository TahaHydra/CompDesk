import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const copyScript = path.resolve('scripts/copy-standalone-assets.js');
const migrationUrl = new URL('./migrate-private-attachments.mjs', import.meta.url);
const ticket = '11111111-1111-4111-8111-111111111111';
const filename = '22222222-2222-4222-8222-222222222222.txt';
const oldPath = `/uploads/${ticket}/${filename}`;
const trackedPlaceholder = path.resolve('public/uploads/.gitkeep');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compdesk-private-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, '.next', 'standalone'), { recursive: true });
    await fs.mkdir(path.join(root, 'public', 'uploads', ticket), { recursive: true });
    await fs.writeFile(path.join(root, 'public', oldPath), 'private content');
    return root;
}

function database(record, { failUpdate = false } = {}) {
    return { attachment: {
        findMany: async ({ where }) => {
            const clauses = where.OR || [where];
            return clauses.some(({ path: query }) => record.path.startsWith(query.startsWith)) ? [record] : [];
        },
        update: async ({ data }) => {
            if (failUpdate) throw new Error('database update failed');
            record.path = data.path;
        },
    } };
}

async function migrate(root, record, options) {
    const { migratePrivateAttachments } = await import(migrationUrl);
    return migratePrivateAttachments({ root, storageRoot: path.join(root, 'private'), prisma: database(record, options) });
}

test('build excludes legacy ticket files while preserving original data and public assets', async (t) => {
    const root = await fixture(t);
    for (const asset of ['logo.svg', 'uploads/branding/logo.png', 'uploads/quick-links/link.webp']) {
        const file = path.join(root, 'public', asset);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'public asset');
    }
    const result = spawnSync(process.execPath, [copyScript], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(path.join(root, 'public', oldPath), 'utf8'), 'private content');
    await assert.rejects(fs.stat(path.join(root, '.next', 'standalone', 'public', oldPath)), { code: 'ENOENT' });
    for (const asset of ['logo.svg', 'uploads/branding/logo.png', 'uploads/quick-links/link.webp']) {
        assert.equal(await fs.readFile(path.join(root, '.next', 'standalone', 'public', asset), 'utf8'), 'public asset');
    }
});

test('Docker public COPY inputs preserve public assets without merging original legacy tickets', async (t) => {
    const root = await fixture(t);
    for (const asset of ['logo.svg', 'uploads/branding/logo.png', 'uploads/quick-links/link.webp']) {
        const file = path.join(root, 'public', asset);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'public asset');
    }
    const build = spawnSync(process.execPath, [copyScript], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(build.status, 0, build.stderr);
    const imageRoot = path.join(root, 'synthetic-image');
    await fs.mkdir(imageRoot);
    // Exercise Docker's ordered directory-merge semantics using its actual COPY inputs.
    const dockerfile = await fs.readFile(path.resolve('Dockerfile'), 'utf8');
    for (const line of dockerfile.split(/\r?\n/)) {
        const copy = /^COPY --from=builder(?: --chown=\S+)? (\S+) (\S+)$/.exec(line);
        if (!copy || (copy[2] !== './public' && !(copy[1] === '/app/.next/standalone' && copy[2] === './'))) continue;
        assert.ok(copy[1].startsWith('/app/'));
        await fs.cp(path.join(root, copy[1].slice('/app/'.length)), path.join(imageRoot, copy[2]), { recursive: true });
    }
    await assert.rejects(fs.stat(path.join(imageRoot, 'public', oldPath)), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(root, 'public', oldPath), 'utf8'), 'private content');
    for (const asset of ['logo.svg', 'uploads/branding/logo.png', 'uploads/quick-links/link.webp']) {
        assert.equal(await fs.readFile(path.join(imageRoot, 'public', asset), 'utf8'), 'public asset');
    }
});

test('build-before-migration removes static shadows only after preserving verified private bytes', async (t) => {
    const root = await fixture(t);
    const standalone = path.join(root, '.next', 'standalone');
    await fs.cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
    const record = { id: 'attachment', ticketId: ticket, path: oldPath };
    await migrate(root, record);
    assert.equal(record.path, `private/${ticket}/${filename}`);
    assert.equal(await fs.readFile(path.join(root, 'private', ticket, filename), 'utf8'), 'private content');
    await assert.rejects(fs.stat(path.join(root, 'public', oldPath)), { code: 'ENOENT' });
    const { setupFsCheck } = require('next/dist/server/lib/router-utils/filesystem');
    const { defaultConfig } = require('next/dist/server/config-shared');
    const checker = await setupFsCheck({ dir: standalone, dev: true, config: defaultConfig });
    await assert.rejects(fs.stat(path.join(standalone, 'public', oldPath)), { code: 'ENOENT' });
    assert.notEqual((await checker.getItem(oldPath))?.type, 'publicFolder', 'Next must not find a public file that shadows the protected route');
});

test('already-private records recover their sole standalone copy and remove the static shadow', async (t) => {
    const root = await fixture(t);
    await fs.cp(path.join(root, 'public'), path.join(root, '.next', 'standalone', 'public'), { recursive: true });
    await fs.unlink(path.join(root, 'public', oldPath));
    await migrate(root, { id: 'attachment', ticketId: ticket, path: `private/${ticket}/${filename}` });
    assert.equal(await fs.readFile(path.join(root, 'private', ticket, filename), 'utf8'), 'private content');
    await assert.rejects(fs.stat(path.join(root, '.next', 'standalone', 'public', oldPath)), { code: 'ENOENT' });
});

test('same-size conflicting private bytes fail closed and preserve both copies', async (t) => {
    const root = await fixture(t);
    await fs.mkdir(path.join(root, 'private', ticket), { recursive: true });
    await fs.writeFile(path.join(root, 'private', ticket, filename), 'other content!!');
    const record = { id: 'attachment', ticketId: ticket, path: oldPath };
    await assert.rejects(migrate(root, record), /conflict/i);
    assert.equal(await fs.readFile(path.join(root, 'public', oldPath), 'utf8'), 'private content');
    assert.equal(record.path, oldPath);
});

test('database failure preserves public sources and a safe private copy', async (t) => {
    const root = await fixture(t);
    await assert.rejects(migrate(root, { id: 'attachment', ticketId: ticket, path: oldPath }, { failUpdate: true }), /database update failed/);
    assert.equal(await fs.readFile(path.join(root, 'public', oldPath), 'utf8'), 'private content');
    assert.equal(await fs.readFile(path.join(root, 'private', ticket, filename), 'utf8'), 'private content');
});

test('untracked public ticket files block startup migration without deleting sole copies', async (t) => {
    const root = await fixture(t);
    const { migratePrivateAttachments } = await import(migrationUrl);
    await assert.rejects(migratePrivateAttachments({ root, storageRoot: path.join(root, 'private'), prisma: { attachment: { findMany: async () => [] } } }), /unhandled|untracked/i);
    assert.equal(await fs.readFile(path.join(root, 'public', oldPath), 'utf8'), 'private content');
});

test('standalone startup refuses unsafe storage before importing the serving process', async (t) => {
    const root = await fixture(t);
    const marker = path.join(root, 'server-started');
    await fs.writeFile(path.join(root, '.next', 'standalone', 'server.js'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');`);
    const result = spawnSync(process.execPath, [path.resolve('scripts/start-standalone.mjs')], {
        cwd: root, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, DATABASE_URL: '', ATTACHMENT_STORAGE_DIR: path.join(root, 'public') },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot be inside a public directory/);
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(root, 'public', oldPath), 'utf8'), 'private content');
});

for (const script of ['clean-build.js', 'copy-standalone-assets.js']) {
    test(`${script} accepts the tracked zero-byte uploads placeholder`, async (t) => {
        const root = await fixture(t);
        const uploads = path.join(root, '.next', 'standalone', 'public', 'uploads');
        await fs.mkdir(uploads, { recursive: true });
        await fs.copyFile(trackedPlaceholder, path.join(uploads, '.gitkeep'));
        await fs.copyFile(trackedPlaceholder, path.join(root, 'public', 'uploads', '.gitkeep'));
        const result = spawnSync(process.execPath, [path.resolve('scripts', script)], { cwd: root, encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(await fs.readFile(path.join(root, 'public', oldPath), 'utf8'), 'private content');
    });

    test(`${script} preserves a sole legacy standalone copy until migration handles it`, async (t) => {
        const root = await fixture(t);
        const served = path.join(root, '.next', 'standalone', 'public', oldPath);
        await fs.mkdir(path.dirname(served), { recursive: true });
        await fs.copyFile(path.join(root, 'public', oldPath), served);
        await fs.unlink(path.join(root, 'public', oldPath));
        const result = spawnSync(process.execPath, [path.resolve('scripts', script)], { cwd: root, encoding: 'utf8', windowsHide: true });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /migration|legacy/i);
        assert.equal(await fs.readFile(served, 'utf8'), 'private content');
    });
}

test('startup migration accepts only the regular zero-byte uploads placeholder', async (t) => {
    const root = await fixture(t);
    await fs.copyFile(trackedPlaceholder, path.join(root, 'public', 'uploads', '.gitkeep'));
    await fs.cp(path.join(root, 'public'), path.join(root, '.next', 'standalone', 'public'), { recursive: true });
    await migrate(root, { id: 'attachment', ticketId: ticket, path: oldPath });
    for (const publicRoot of ['public', '.next/standalone/public']) {
        assert.equal((await fs.stat(path.join(root, publicRoot, 'uploads', '.gitkeep'))).size, 0);
    }
    assert.equal(await fs.readFile(path.join(root, 'private', ticket, filename), 'utf8'), 'private content');
});

for (const [name, content] of [['.gitkeep', 'private data'], ['unexpected.txt', ''], ['.gitkeep', null]]) {
    test(`guards and startup migration reject unexpected upload ${name} (${content === null ? 'directory' : 'file'})`, async (t) => {
        const root = await fixture(t);
        const uploads = path.join(root, '.next', 'standalone', 'public', 'uploads');
        await fs.mkdir(uploads, { recursive: true });
        if (content === null) await fs.mkdir(path.join(uploads, name));
        else await fs.writeFile(path.join(uploads, name), content);
        for (const script of ['clean-build.js', 'copy-standalone-assets.js']) {
            const result = spawnSync(process.execPath, [path.resolve('scripts', script)], { cwd: root, encoding: 'utf8', windowsHide: true });
            assert.notEqual(result.status, 0);
            if (content === null) assert.ok((await fs.stat(path.join(uploads, name))).isDirectory());
            else assert.equal(await fs.readFile(path.join(uploads, name), 'utf8'), content);
        }
        await assert.rejects(migrate(root, { id: 'attachment', ticketId: ticket, path: oldPath }), /Unhandled public upload/);
        if (content === null) assert.ok((await fs.stat(path.join(uploads, name))).isDirectory());
        else assert.equal(await fs.readFile(path.join(uploads, name), 'utf8'), content);
    });
}

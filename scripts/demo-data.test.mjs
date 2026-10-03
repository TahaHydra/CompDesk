import assert from 'node:assert/strict';
import test from 'node:test';

const demo = await import('./demo-data.mjs').catch((error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
});

test('demo ownership metadata rejects malformed or unbounded identifiers', () => {
    assert.equal(typeof demo.parseDemoLedger, 'function', 'shared demo service is available');
    assert.equal(demo.parseDemoLedger('not json'), null);
    assert.equal(demo.parseDemoLedger(JSON.stringify({ version: 1, records: { user: ['*'] } })), null);
    assert.equal(demo.parseDemoLedger(JSON.stringify({ version: 1, records: { arbitraryTable: [] } })), null);
});

test('demo ownership metadata contains IDs, never generated passwords', () => {
    assert.equal(typeof demo.parseDemoLedger, 'function', 'shared demo service is available');
    const ledger = { version: 1, installedAt: '2026-10-02T10:00:00.000Z', records: { user: ['10000000-0000-0000-0000-000000000001'], ticket: [] } };
    assert.deepEqual(demo.parseDemoLedger(JSON.stringify(ledger)), ledger);
    assert.equal(demo.parseDemoLedger(JSON.stringify({ ...ledger, password: 'secret' })), null);
});

test('cleanup requires an explicit confirmation before starting a transaction', async () => {
    assert.equal(typeof demo.removeDemoData, 'function', 'shared demo service is available');
    const client = { $transaction: () => { throw new Error('must not reach database'); } };
    await assert.rejects(demo.removeDemoData(client, { protectedUserId: 'admin', confirmation: '' }), /confirmation/i);
});

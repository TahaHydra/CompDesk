import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { missingDatabaseColumns, verifyDatabaseSchema } from './database-schema.mjs';

const models = Prisma.dmmf.datamodel.models;
const complete = models.flatMap(model => model.fields.filter(field => field.kind !== 'object').map(field => ({
    table_name: model.dbName || model.name, column_name: field.dbName || field.name,
})));

test('accepts every persisted generated-client column, ignoring relations', () => {
    assert.deepEqual(missingDatabaseColumns(complete, models), []);
});
test('rejects the observed temporary attachment drift even with all migrations recorded', async () => {
    const rows = complete.filter(row => !(row.table_name === 'temporary_attachments' && row.column_name === 'blob_removed_at'));
    assert.deepEqual(missingDatabaseColumns(rows, models), ['temporary_attachments.blob_removed_at']);
    await assert.rejects(verifyDatabaseSchema(async () => rows), /temporary_attachments.blob_removed_at/);
});
test('fails closed on unavailable metadata', async () => {
    await assert.rejects(verifyDatabaseSchema(async () => { throw new Error('offline'); }), /offline/);
});

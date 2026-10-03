import { Prisma } from '@prisma/client';

export const SCHEMA_COLUMNS_QUERY = `SELECT table_name, column_name
    FROM information_schema.columns WHERE table_schema = 'public'`;

export function missingDatabaseColumns(rows, models = Prisma.dmmf.datamodel.models) {
    const actual = new Set(rows.map(row => `${row.table_name}.${row.column_name}`));
    return models.flatMap(model => model.fields
        .filter(field => field.kind !== 'object')
        .map(field => `${model.dbName || model.name}.${field.dbName || field.name}`))
        .filter(column => !actual.has(column));
}

export async function verifyDatabaseSchema(query) {
    const missing = missingDatabaseColumns(await query(SCHEMA_COLUMNS_QUERY));
    if (missing.length) throw new Error(`Database schema is incompatible with this application: missing ${missing.join(', ')}. Apply the release migrations before starting CompDesk.`);
}

export const SCHEMA_COLUMNS_QUERY: string;
export function missingDatabaseColumns(rows: Array<{ table_name: string; column_name: string }>): string[];
export function verifyDatabaseSchema(query: (sql: string) => Promise<Array<{ table_name: string; column_name: string }>>): Promise<void>;

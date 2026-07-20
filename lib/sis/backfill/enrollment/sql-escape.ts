// Escapes a string for safe inclusion inside a single-quoted Postgres SQL
// literal. Doubles embedded single quotes per the SQL standard. Used by the
// AY2026 enrollment-import SQL builder (build-import.ts) — never trusts a
// name/value straight into generated SQL text.
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Same as sqlString, but emits the unquoted literal NULL for
// null/undefined/whitespace-only input.
export function sqlStringOrNull(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '')
    return 'NULL';
  return sqlString(value);
}

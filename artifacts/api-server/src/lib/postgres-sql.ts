/**
 * Translate the small SQLite dialect surface used by the local ledger store.
 * The hosted review database uses PostgreSQL; local household servers remain
 * SQLite and do not pass through this adapter.
 */
export function translateLedgerSql(sql: string): string | null {
  let translated = sql.trim();

  const pragmaColumns = translated.match(/^PRAGMA\s+table_info\((["']?)([a-z_][a-z0-9_]*)\1\)\s*;?$/i);
  if (pragmaColumns) {
    const tableName = pragmaColumns[2].toLowerCase();
    return `SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = '${tableName}'
      ORDER BY ordinal_position`;
  }
  if (/^PRAGMA\b/i.test(translated)) return null;

  if (/^DELETE\s+FROM\s+budgets\s+WHERE\s+rowid\s+NOT\s+IN\s*\(\s*SELECT\s+MAX\(rowid\)\s+FROM\s+budgets\s+GROUP\s+BY\s+group_id\s*,\s*category_id\s*,\s*month\s*\)\s*;?$/is.test(translated)) {
    translated = `DELETE FROM budgets
      WHERE ctid NOT IN (
        SELECT DISTINCT ON (group_id, category_id, month) ctid
        FROM budgets
        ORDER BY group_id, category_id, month, ctid DESC
      )`;
  } else {
    translated = translated.replace(/\browid\b/gi, "ctid");
  }

  translated = translated.replace(
    /\bBEGIN\s+IMMEDIATE\b/gi,
    "BEGIN; SELECT pg_advisory_xact_lock(hashtext(current_schema()))",
  );
  translated = translated.replace(
    /json_extract\(\s*transaction_template_json\s*,\s*'\$\.categoryId'\s*\)/gi,
    "(transaction_template_json::jsonb ->> 'categoryId')",
  );
  translated = translated.replace(
    /\b([a-z_][a-z0-9_.]*)\s*=\s*(\$\d+)\s+COLLATE\s+NOCASE\b/gi,
    "LOWER($1) = LOWER($2)",
  );
  translated = translated.replace(
    /\b([a-z_][a-z0-9_.]*)\s+COLLATE\s+NOCASE\b/gi,
    "LOWER($1)",
  );

  const ignoredInsert = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(translated);
  if (ignoredInsert) {
    translated = translated.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO");
  }

  translated = replaceQuestionMarks(translated);
  translated = translated.replace(
    /\b([a-z_][a-z0-9_.]*)\s*=\s*(\$\d+)\s+COLLATE\s+NOCASE\b/gi,
    "LOWER($1) = LOWER($2)",
  );

  if (ignoredInsert && !/\bON\s+CONFLICT\b/i.test(translated)) {
    translated = translated.replace(/;\s*$/, "");
    translated += " ON CONFLICT DO NOTHING";
  }

  if (/^\s*INSERT\s+INTO\s+sync_events\b/i.test(translated)
    && !/\bRETURNING\b/i.test(translated)) {
    translated = translated.replace(/;\s*$/, "");
    translated += " RETURNING sequence";
  }

  return translated;
}

function replaceQuestionMarks(sql: string) {
  let output = "";
  let parameter = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index++) {
    const character = sql[index]!;
    const next = sql[index + 1];

    if (lineComment) {
      output += character;
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      output += character;
      if (character === "*" && next === "/") {
        output += next;
        index++;
        blockComment = false;
      }
      continue;
    }
    if (singleQuoted) {
      output += character;
      if (character === "'" && next === "'") {
        output += next;
        index++;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      output += character;
      if (character === '"' && next === '"') {
        output += next;
        index++;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }
    if (character === "-" && next === "-") {
      output += "--";
      index++;
      lineComment = true;
      continue;
    }
    if (character === "/" && next === "*") {
      output += "/*";
      index++;
      blockComment = true;
      continue;
    }
    if (character === "'") {
      singleQuoted = true;
      output += character;
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
      output += character;
      continue;
    }
    if (character === "?") {
      output += `$${++parameter}`;
      continue;
    }
    output += character;
  }

  return output;
}

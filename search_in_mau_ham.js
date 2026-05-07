const Database = require('better-sqlite3');

const db = new Database('./labo_data.db');

// List all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables in database:', tables);

// Get column info for each table
tables.forEach(t => {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\nTable: ${t.name}`);
  console.log('Columns:', cols.map(c => c.name));
});

const searchTerm = '%IN mẫu hàm%';

tables.forEach(t => {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  const columnNames = cols.map(c => c.name);
  const whereClause = columnNames.map(c => `${c} LIKE ?`).join(' OR ');

  const rows = db.prepare(`SELECT * FROM ${t.name} WHERE ${whereClause}`).all(
    ...columnNames.map(() => searchTerm)
  );

  if (rows.length > 0) {
    console.log(`\n=== Found ${rows.length} matching rows in table "${t.name}" ===`);
    rows.forEach((row, index) => {
      console.log(`\n--- Row ${index + 1} ---`);
      console.log(JSON.stringify(row, null, 2));
    });
  }
});

db.close();

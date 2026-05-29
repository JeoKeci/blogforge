const Database = require('better-sqlite3');
const path = require('path');

try {
  const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
  console.log('Connecting to database:', dbPath);
  const db = new Database(dbPath, { readonly: true });

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('\n--- TABLES ---');
  for (const table of tables) {
    const count = db.prepare(`SELECT count(*) as count FROM ${table.name}`).get();
    console.log(`${table.name}: ${count.count} rows`);
  }

  console.log('\n--- PROJECTS ---');
  const projects = db.prepare("SELECT id, name, siteUrl, state FROM Project").all();
  console.log(projects);

  console.log('\n--- ARTICLES ---');
  const articles = db.prepare("SELECT id, title, state, wordCount FROM Article").all();
  console.log(articles);

  console.log('\n--- SOURCES ---');
  const sources = db.prepare("SELECT id, displayName, type, status FROM ContentSource").all();
  console.log(sources);

  console.log('\n--- STRATEGY ---');
  const strategies = db.prepare("SELECT id, projectId, summary FROM Strategy").all();
  console.log(strategies);

} catch (err) {
  console.error('Error reading database:', err);
}

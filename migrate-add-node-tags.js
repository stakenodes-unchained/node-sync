const Database = require("better-sqlite3");

const dbPath = process.argv[2] || "./sync_checker.db";
const db = new Database(dbPath);

try {
  const hasNodesTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("nodes");

  if (!hasNodesTable) {
    console.error(`❌ nodes table was not found in ${dbPath}`);
    process.exitCode = 1;
  } else {
    const columns = db.prepare("PRAGMA table_info(nodes)").all();
    const hasTagsColumn = columns.some((col) => col.name === "tags");

    if (hasTagsColumn) {
      console.log("✅ tags column already exists on nodes table (no-op)");
    } else {
      db.exec("ALTER TABLE nodes ADD COLUMN tags TEXT DEFAULT '[]'");
      console.log("✅ Added tags column to nodes table");
    }
  }
} catch (error) {
  console.error(`❌ Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}

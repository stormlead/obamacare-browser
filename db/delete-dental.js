const { isPostgres, getPool, getDatabase } = require('./init');

async function deleteDentalPlans() {
  console.log('Deleting dental plans (metal_level High or Low)...');

  if (isPostgres()) {
    const pool = getPool();
    const result = await pool.query("DELETE FROM plans WHERE metal_level IN ('High', 'Low')");
    console.log('Deleted', result.rowCount, 'dental plans from PostgreSQL');
  } else {
    const db = getDatabase();
    const info = db.prepare("DELETE FROM plans WHERE metal_level IN ('High', 'Low')").run();
    console.log('Deleted', info.changes, 'dental plans from SQLite');
    db.close();
  }
}

deleteDentalPlans()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });

import pg from 'pg'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5433/kmplus',
})

async function run() {
  const before = await pool.query(
    `SELECT "userId", "connectorSlug", purchased, "installedAt" FROM connector_installs ORDER BY "userId", "connectorSlug"`
  )
  console.log('Before:', before.rows.length, 'install(s)')
  for (const row of before.rows) {
    console.log(`  ${row.userId} · ${row.connectorSlug} · purchased=${row.purchased}`)
  }

  const deleted = await pool.query(`DELETE FROM connector_installs RETURNING id`)
  console.log(`Deleted ${deleted.rowCount} connector install(s) for all users.`)

  const after = await pool.query(`SELECT count(*)::int AS n FROM connector_installs`)
  console.log('After:', after.rows[0].n, 'install(s)')
}

run()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => pool.end())

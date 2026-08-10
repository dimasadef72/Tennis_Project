const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

const sql = new Bun.SQL(databaseUrl)

await sql`
  insert into courts (name)
  values ('Lapangan 1'), ('Lapangan 2')
  on conflict do nothing
`

const courts = await sql`select id, name, is_active from courts order by name`
console.log(courts)

await sql.close()

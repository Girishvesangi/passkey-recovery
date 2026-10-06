import 'dotenv/config'
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';

async function main(){

const db= new Pool({connectionString: process.env.DATABASE_URL});

await db.query(
    `
    CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        ran_at timestamptz NOT NULL DEFAULT now()
    )
    `
);

const {rows} =await db.query('SELECT name FROM _migrations');
const ran =new Set(rows.map((r:{name:string})=>r.name));

for (const file of readdirSync('migrations').filter(f=> f.endsWith('.sql')).sort()){
    if( ran.has(file)){
        console.log(`Skipping ${file} (already applied)`);
        continue;
    }
    console.log(`Running ${file}...`);
    await db.query(readFileSync(`migrations/${file}`,'utf8'));
    await db.query('INSERT INTO _migrations (name) VALUES ($1)',[file]);

}
console.log('Done.');
await db.end();
}

main().catch((err)=>{
    console.error(err);
    process.exit(1);
})
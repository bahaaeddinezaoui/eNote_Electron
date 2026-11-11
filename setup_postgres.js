import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Default PostgreSQL configuration. The password is never kept in the source
// tree: supply it with PGPASSWORD, or rely on the server's local auth rules.
const defaultConfig = {
  user: 'postgres',
  host: 'localhost',
  port: 5432,
  password: '',
  database: 'postgres' // Connect to default database first
}

// Target database name
const targetDatabase = 'eNote'

async function setupPostgreSQL() {
  console.log('=== PostgreSQL Setup Script ===\n')
  
  // Check if password is provided via environment variables
  const config = {
    user: process.env.PGUSER || defaultConfig.user,
    host: process.env.PGHOST || defaultConfig.host,
    port: parseInt(process.env.PGPORT || defaultConfig.port, 10),
    password: process.env.PGPASSWORD || defaultConfig.password,
    database: process.env.PGDATABASE || defaultConfig.database
  }
  
  console.log('Configuration:')
  console.log(`  Host: ${config.host}`)
  console.log(`  Port: ${config.port}`)
  console.log(`  User: ${config.user}`)
  console.log(`  Password: ${config.password ? '***' : '(none)'}`)
  console.log(`  Target Database: ${targetDatabase}\n`)
  
  let pool = null
  
  try {
    // Step 1: Test connection to PostgreSQL
    console.log('Step 1: Testing PostgreSQL connection...')
    pool = new Pool(config)
    await pool.query('SELECT NOW()')
    console.log('✓ Successfully connected to PostgreSQL\n')
    
    // Step 2: Check if database exists
    console.log('Step 2: Checking if database exists...')
    const dbCheckResult = await pool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDatabase]
    )
    
    if (dbCheckResult.rows.length === 0) {
      console.log(`Database '${targetDatabase}' does not exist. Creating...`)
      await pool.query(`CREATE DATABASE "${targetDatabase}"`)
      console.log(`✓ Database '${targetDatabase}' created successfully\n`)
    } else {
      console.log(`✓ Database '${targetDatabase}' already exists\n`)
    }
    
    // Close connection to postgres database
    await pool.end()
    
    // Step 3: Connect to the target database
    console.log('Step 3: Connecting to target database...')
    const targetConfig = { ...config, database: targetDatabase }
    pool = new Pool(targetConfig)
    await pool.query('SELECT NOW()')
    console.log(`✓ Connected to '${targetDatabase}'\n`)
    
    // Step 4: Execute schema script
    console.log('Step 4: Creating database schema...')
    const schemaPath = path.join(__dirname, 'eNote_pg.sql')
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`)
    }
    
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8')
    
    // Strip full-line comments BEFORE splitting on ';', so a seed INSERT that
    // sits under a comment line is not merged into the comment and skipped.
    const schemaNoComments = schemaSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
    
    // Split by semicolons and execute each statement
    const statements = schemaNoComments
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)
    
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await pool.query(statement)
        } catch (error) {
          // Ignore errors for IF NOT EXISTS statements
          if (!error.message.includes('already exists')) {
            console.warn(`Warning: ${error.message}`)
          }
        }
      }
    }
    
    console.log('✓ Database schema created successfully\n')
    
    // Step 5: Verify tables were created
    console.log('Step 5: Verifying tables...')
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    
    console.log(`Found ${tablesResult.rows.length} tables:`)
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`)
    })
    console.log()
    
    // Step 6: Check for admin user
    console.log('Step 6: Checking for admin user...')
    const userCheckResult = await pool.query(
      'SELECT * FROM "user" WHERE user_username = $1',
      ['admin']
    )
    
    if (userCheckResult.rows.length === 0) {
      console.log('Admin user not found. Creating default admin user...')
      const bcrypt = await import('bcryptjs')
      const hashedPassword = await bcrypt.hash('admin', 10)
      
      // Create person for admin. person_id is issued by hand and is twelve
      // digits (deploy/server/11-person-id-manual.sql), so it is taken here
      // rather than generated: the first free twelve-digit number.
      const nextIdResult = await pool.query(
        'SELECT COALESCE(MAX(person_id), 100000000000) + 1 AS next_id FROM person WHERE person_id >= 100000000000'
      )
      const personResult = await pool.query(`
        INSERT INTO person (person_id, person_first_name_la, person_last_name_la)
        VALUES ($1, $2, $3)
        RETURNING person_id
      `, [nextIdResult.rows[0].next_id, 'Admin', 'User'])
      
      const personId = personResult.rows[0].person_id
      
      // Create admin user, carrying the ADMIN role
      await pool.query(`
        INSERT INTO "user" (person_id, user_username, user_password_hash, user_email, role_id)
        VALUES ($1, $2, $3, $4, (SELECT role_id FROM "role" WHERE role_code = 'ADMIN'))
      `, [personId, 'admin', hashedPassword, 'admin@enote.local'])
      
      console.log('✓ Admin user created (username: admin, password: admin)\n')
    } else {
      console.log('✓ Admin user already exists\n')
    }
    
    console.log('=== PostgreSQL Setup Complete ===')
    console.log('\nYou can now start the application with: npm run dev')
    console.log('Default login credentials:')
    console.log('  Username: admin')
    console.log('  Password: admin')
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message)
    console.error('\nTroubleshooting:')
    console.error('1. Make sure PostgreSQL is installed and running')
    console.error('2. Verify the connection settings in the script')
    console.error('3. Check if the postgres user has the necessary permissions')
    console.error('\nYou can set custom credentials using environment variables:')
    console.error('  PGUSER=your_user PGPASSWORD=your_password node setup_postgres.js')
    process.exit(1)
  } finally {
    if (pool) {
      await pool.end()
    }
  }
}

setupPostgreSQL()

# PostgreSQL Setup Guide for eNote

## Prerequisites

Before running the application, you need to have PostgreSQL installed and configured.

## 1. Install PostgreSQL

### Windows
1. Download PostgreSQL from https://www.postgresql.org/download/windows/
2. Run the installer and follow the setup wizard
3. During installation, note down:
   - The password you set for the `postgres` user (default is often `postgres`)
   - The port number (default is 5432)

### Alternative: Using Docker
If you have Docker installed, you can run PostgreSQL in a container:

```bash
docker run --name enote-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=eNote -p 5432:5432 -d postgres:15
```

## 2. Configure Connection

The application will try to connect with these default settings:
- **Host:** localhost
- **Port:** 5432
- **User:** postgres
- **Password:** postgres
- **Database:** eNote

If your PostgreSQL installation uses different credentials, you can either:
1. Modify the connection settings in `src/main/db.js`
2. Set environment variables before running the setup script

## 3. Run the Setup Script

Once PostgreSQL is running, execute the setup script to create the database and schema:

### Using default credentials:
```bash
node setup_postgres.js
```

### Using custom credentials:
```bash
PGUSER=your_username PGPASSWORD=your_password node setup_postgres.js
```

### On Windows PowerShell:
```powershell
$env:PGUSER="your_username"
$env:PGPASSWORD="your_password"
node setup_postgres.js
```

## 4. What the Setup Script Does

The setup script performs the following steps:

1. **Tests PostgreSQL connection** - Verifies that PostgreSQL is accessible
2. **Creates the database** - Creates the `eNote` database if it doesn't exist
3. **Executes the schema** - Runs the SQL schema from `eNote_pg.sql` to create all tables
4. **Verifies tables** - Lists all created tables for confirmation
5. **Creates admin user** - Creates a default admin user if one doesn't exist:
   - Username: `admin`
   - Password: `admin`
   - Email: `admin@enote.local`

## 5. Troubleshooting

### Connection Refused
- Make sure PostgreSQL is running
- Check that the service is started (Windows Services -> postgresql-x64-xx)

### Authentication Failed
- Verify the postgres user password
- Check pg_hba.conf authentication settings
- Try using the password you set during PostgreSQL installation

### Port Already in Use
- Check if another application is using port 5432
- Configure PostgreSQL to use a different port
- Update the connection settings accordingly

### Database Already Exists
- The script will detect existing databases and skip creation
- If you want to start fresh, manually drop the database first:
  ```sql
  DROP DATABASE "eNote";
  ```

## 6. Manual Setup (Alternative)

If the automated script doesn't work, you can set up the database manually:

### Using pgAdmin or psql:

1. **Create the database:**
   ```sql
   CREATE DATABASE "eNote";
   ```

2. **Connect to the eNote database and run the schema:**
   ```bash
   psql -U postgres -d eNote -f eNote_pg.sql
   ```

3. **Create admin user manually:**
   ```sql
   -- First, generate a bcrypt hash for 'admin' password
   -- Or use the provided hash below
   INSERT INTO person (person_first_name_la, person_last_name_la)
   VALUES ('Admin', 'User')
   RETURNING person_id;
   
   -- Replace PERSON_ID with the returned value
   INSERT INTO "user" (person_id, user_username, user_password_hash, user_email, role_id)
   VALUES (1, 'admin', '$2b$10$almrhu3aAgqNXr3DUMhuTOdMUcTxT3SzcRt28SkhxvQUAagYAbxhy', 'admin@enote.local',
           (SELECT role_id FROM "role" WHERE role_code = 'ADMIN'));
   ```

## 7. Starting the Application

After successful setup, start the application:

```bash
npm run dev
```

Login with:
- **Username:** admin
- **Password:** admin

## 8. Security Notes

⚠️ **Important:** Change the default admin password after first login!

The default credentials are:
- Username: `admin`
- Password: `admin`

Change these immediately in a production environment.

## 9. Environment Variables

You can configure the database connection using these environment variables:

- `PGUSER` - PostgreSQL username
- `PGPASSWORD` - PostgreSQL password
- `PGHOST` - PostgreSQL host (default: localhost)
- `PGPORT` - PostgreSQL port (default: 5432)
- `PGDATABASE` - PostgreSQL database name (default: eNote)

Set these in your system environment or in a `.env` file if you add dotenv support.

import pg from "pg";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const pool = new pg.Pool({
  host: "aws-0-us-west-2.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.zylmblrswsyvizvqgtui",
  password: "sevakogan1982",
  ssl: { rejectUnauthorized: false },
});

const statements = [
  'DROP TABLE IF EXISTS verification CASCADE',
  'DROP TABLE IF EXISTS account CASCADE',
  'DROP TABLE IF EXISTS session CASCADE',
  'DROP TABLE IF EXISTS "user" CASCADE',
  `CREATE TABLE "user" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    image TEXT,
    role TEXT NOT NULL DEFAULT 'student',
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "firstName" TEXT DEFAULT '',
    "lastName" TEXT DEFAULT '',
    banned BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE session (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    token TEXT NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "impersonatedBy" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE account (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP,
    "refreshTokenExpiresAt" TIMESTAMP,
    scope TEXT,
    password TEXT,
    "idToken" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE verification (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
];

for (const sql of statements) {
  try {
    await pool.query(sql);
    console.log("OK:", sql.substring(0, 50));
  } catch (e) {
    console.error("ERR:", e.message);
  }
}

const res = await pool.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
);
console.log("All tables:", res.rows.map((r) => r.table_name));
pool.end();

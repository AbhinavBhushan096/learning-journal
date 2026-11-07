import sql from 'mssql';

const schema = [
  `IF OBJECT_ID(N'dbo.users', N'U') IS NULL
   CREATE TABLE dbo.users (
     id INT IDENTITY(1,1) PRIMARY KEY,
     email NVARCHAR(320) NOT NULL UNIQUE,
     password_hash NVARCHAR(200) NOT NULL,
     password_salt NVARCHAR(80) NOT NULL,
     created_at NVARCHAR(40) NOT NULL DEFAULT (CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127))
   )`,
  `IF OBJECT_ID(N'dbo.sessions', N'U') IS NULL
   CREATE TABLE dbo.sessions (
     id INT IDENTITY(1,1) PRIMARY KEY,
     user_id INT NOT NULL REFERENCES dbo.users(id) ON DELETE CASCADE,
     token_hash NVARCHAR(80) NOT NULL UNIQUE,
     expires_at NVARCHAR(40) NOT NULL,
     created_at NVARCHAR(40) NOT NULL DEFAULT (CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127))
   )`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sessions_hash' AND object_id = OBJECT_ID(N'dbo.sessions'))
   CREATE INDEX idx_sessions_hash ON dbo.sessions(token_hash)`,
  `IF OBJECT_ID(N'dbo.profile', N'U') IS NULL
   CREATE TABLE dbo.profile (
     id INT PRIMARY KEY CHECK(id = 1),
     name NVARCHAR(200) NOT NULL,
     handle NVARCHAR(80) NOT NULL,
     bio NVARCHAR(MAX) NOT NULL,
     location NVARCHAR(200) NOT NULL,
     role NVARCHAR(200) NOT NULL,
     avatar_url NVARCHAR(1000) NULL,
     quote NVARCHAR(500) NOT NULL,
     currently_learning NVARCHAR(200) NOT NULL,
     current_progress INT NOT NULL DEFAULT 0,
     github_url NVARCHAR(1000) NULL,
     linkedin_url NVARCHAR(1000) NULL,
     youtube_url NVARCHAR(1000) NULL,
     about NVARCHAR(MAX) NULL,
     education NVARCHAR(MAX) NULL,
     experience NVARCHAR(MAX) NULL,
     skills NVARCHAR(MAX) NULL,
     resume_url NVARCHAR(1000) NULL,
     twitter_url NVARCHAR(1000) NULL,
     updated_at NVARCHAR(40) NOT NULL DEFAULT (CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127))
   )`,
  `IF OBJECT_ID(N'dbo.entries', N'U') IS NULL
   CREATE TABLE dbo.entries (
     id INT IDENTITY(1,1) PRIMARY KEY,
     type NVARCHAR(20) NOT NULL CHECK(type IN (N'lecture',N'note',N'anki',N'project',N'article',N'questions',N'image')),
     title NVARCHAR(300) NOT NULL,
     description NVARCHAR(MAX) NOT NULL DEFAULT N'',
     occurred_at NVARCHAR(40) NOT NULL,
     url NVARCHAR(1000) NULL,
     thumbnail_url NVARCHAR(1000) NULL,
     image_url NVARCHAR(1000) NULL,
     subject NVARCHAR(120) NOT NULL DEFAULT N'General',
     duration_minutes INT NOT NULL DEFAULT 0,
     metrics NVARCHAR(MAX) NOT NULL DEFAULT N'{}',
     published INT NOT NULL DEFAULT 1,
     created_at NVARCHAR(40) NOT NULL DEFAULT (CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127)),
     updated_at NVARCHAR(40) NOT NULL DEFAULT (CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 127))
   )`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_entries_occurred' AND object_id = OBJECT_ID(N'dbo.entries'))
   CREATE INDEX idx_entries_occurred ON dbo.entries(occurred_at DESC)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_entries_type' AND object_id = OBJECT_ID(N'dbo.entries'))
   CREATE INDEX idx_entries_type ON dbo.entries(type, published)`,
  `IF OBJECT_ID(N'dbo.tags', N'U') IS NULL
   CREATE TABLE dbo.tags (
     id INT IDENTITY(1,1) PRIMARY KEY,
     name NVARCHAR(64) NOT NULL UNIQUE
   )`,
  `IF OBJECT_ID(N'dbo.entry_tags', N'U') IS NULL
   CREATE TABLE dbo.entry_tags (
     entry_id INT NOT NULL REFERENCES dbo.entries(id) ON DELETE CASCADE,
     tag_id INT NOT NULL REFERENCES dbo.tags(id) ON DELETE CASCADE,
     PRIMARY KEY(entry_id, tag_id)
   )`,
  `IF OBJECT_ID(N'dbo.daily_goals', N'U') IS NULL
   CREATE TABLE dbo.daily_goals (
     id INT IDENTITY(1,1) PRIMARY KEY,
     title NVARCHAR(200) NOT NULL,
     goal_date NVARCHAR(10) NOT NULL,
     completed INT NOT NULL DEFAULT 0,
     sort_order INT NOT NULL DEFAULT 0
   )`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_goals_date' AND object_id = OBJECT_ID(N'dbo.daily_goals'))
   CREATE INDEX idx_goals_date ON dbo.daily_goals(goal_date)`
];

function translate(sql) {
  let index = 0;
  let text = sql.replace(/\?/g, () => `@p${index++}`);
  text = text.replace(/datetime\('now'\)/gi, 'SYSUTCDATETIME()');
  text = text.replace(/\sLIMIT\s+(@p\d+)\s*$/i, ' OFFSET 0 ROWS FETCH NEXT $1 ROWS ONLY');
  if (/^\s*insert\s+/i.test(text) && /\)\s*VALUES\s*\(/i.test(text) && !/output\s+inserted/i.test(text)) {
    text = text.replace(/\)\s*VALUES\s*\(/i, ') OUTPUT INSERTED.id VALUES (');
  }
  return text;
}

class AzureDb {
  constructor(pool) {
    this.pool = pool;
    this.dialect = 'azure';
    this.tx = null;
  }

  async query(sql, params = []) {
    const request = this.tx ? this.tx.request() : this.pool.request();
    params.forEach((value, index) => request.input(`p${index}`, value === undefined ? null : value));
    return request.query(sql);
  }

  prepare(sql) {
    const text = translate(sql);
    return {
      get: async (...params) => (await this.query(text, params)).recordset[0],
      all: async (...params) => (await this.query(text, params)).recordset,
      run: async (...params) => {
        const result = await this.query(text, params);
        const row = result.recordset?.[0];
        return {
          lastInsertRowid: row ? row.id ?? row.ID : undefined,
          changes: (result.rowsAffected || []).reduce((sum, count) => sum + count, 0)
        };
      }
    };
  }

  async exec(sql) {
    const command = String(sql || '').trim().toUpperCase();
    if (command === 'BEGIN') {
      this.tx = new sql.Transaction(this.pool);
      await this.tx.begin();
      return;
    }
    if (command === 'COMMIT') {
      await this.tx.commit();
      this.tx = null;
      return;
    }
    if (command === 'ROLLBACK') {
      await this.tx.rollback();
      this.tx = null;
      return;
    }
    await this.query(sql);
  }

  close() { return this.pool.close(); }
}

export async function createAzureDatabase(settings) {
  const pool = await sql.connect({
    server: settings.server,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 15000
  });
  const db = new AzureDb(pool);
  for (const statement of schema) await db.exec(statement);
  return db;
}

-- Domains table
CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    domain TEXT UNIQUE NOT NULL,
    is_verified INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    address TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    token TEXT,
    resume_code_hash TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    msgid TEXT,
    account_id TEXT NOT NULL,
    from_name TEXT,
    from_address TEXT,
    to_address TEXT,
    subject TEXT,
    text TEXT,
    html TEXT,
    seen INTEGER DEFAULT 0,
    has_attachments INTEGER DEFAULT 0,
    size INTEGER DEFAULT 0,
    raw_source TEXT,  -- Raw email content
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Attachments table
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    filename TEXT,
    content_type TEXT,
    size INTEGER,
    content TEXT,  -- Base64-encoded content
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounts_expires_at ON accounts(expires_at);
CREATE INDEX IF NOT EXISTS idx_accounts_address ON accounts(address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_resume_code_hash ON accounts(resume_code_hash);
CREATE INDEX IF NOT EXISTS idx_messages_account_id ON messages(account_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Insert default domains (add your own domains manually after deployment)
-- INSERT INTO domains (id, domain) VALUES ('domain-id-1', 'example1.com');
-- INSERT INTO domains (id, domain) VALUES ('domain-id-2', 'example2.com');

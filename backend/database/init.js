const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create a new database connection
const db = new sqlite3.Database(path.join(__dirname, 'Frank.db'), (err) => {
    if (err) {
        console.error('Error opening database:', err);
        return;
    }
    console.log('Connected to Frank database.');
});

// Create tables
db.serialize(() => {
    // Conversations table
    db.run(`CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        summary TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )`);

    // Messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`);

    // Settings table
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )`);

    // Initialize default settings if they don't exist
    const defaultSettings = [
        { key: 'llm_api_endpoint', value: '' },
        { key: 'llm_model', value: '' },
        { key: 'llm_temperature', value: '0.7' },
        { key: 'llm_max_tokens', value: '1000' },
        { key: 'elevenlabs_api_key', value: null },
        { key: 'elevenlabs_voice_id', value: null }
    ];

    defaultSettings.forEach(setting => {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
            [setting.key, setting.value]);
    });

    // Create saved_configs table
    db.run(`
      CREATE TABLE IF NOT EXISTS saved_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        model TEXT NOT NULL,
        temperature TEXT NOT NULL,
        max_tokens TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
});

// Close the database connection
db.close((err) => {
    if (err) {
        console.error('Error closing database:', err);
        return;
    }
    console.log('Frank database initialized successfully.');
}); 
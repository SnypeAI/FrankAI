const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create a new database connection
const db = new sqlite3.Database(path.join(__dirname, 'conversations.db'), (err) => {
    if (err) {
        console.error('Error opening database:', err);
        return;
    }
    console.log('Connected to the conversations database.');
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
});

// Close the database connection
db.close((err) => {
    if (err) {
        console.error('Error closing database:', err);
        return;
    }
    console.log('Database initialized successfully.');
}); 
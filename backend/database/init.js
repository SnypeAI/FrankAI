import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a new database connection
const db = new sqlite3.Database(path.join(__dirname, 'Frank.db'), (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
    console.log('Connected to Frank database.');
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Initialize schema and default data
db.serialize(() => {
    try {
        // Create conversations table
        db.run(`CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            summary TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create messages table
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )`);

        // Create settings table
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create tool_configs table
        db.run(`CREATE TABLE IF NOT EXISTS tool_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool_name TEXT NOT NULL,
            config_key TEXT NOT NULL,
            config_value TEXT,
            is_enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tool_name, config_key)
        )`);

        // Create saved_configs table
        db.run(`CREATE TABLE IF NOT EXISTS saved_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            model TEXT NOT NULL,
            temperature TEXT NOT NULL,
            max_tokens TEXT NOT NULL,
            elevenlabs_api_key TEXT,
            elevenlabs_voice_id TEXT,
            is_default INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create personalities table
        db.run(`CREATE TABLE IF NOT EXISTS personalities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            system_prompt TEXT NOT NULL,
            is_default INTEGER DEFAULT 0,
            is_builtin INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create indexes
        db.run('CREATE INDEX IF NOT EXISTS idx_tool_configs_tool_name ON tool_configs(tool_name)');
        db.run('CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)');

        // Create update trigger for conversations
        db.run(`CREATE TRIGGER IF NOT EXISTS update_conversations_timestamp 
                AFTER UPDATE ON conversations
                BEGIN
                    UPDATE conversations SET updated_at = CURRENT_TIMESTAMP
                    WHERE id = NEW.id;
                END`);

        // Create update trigger for settings
        db.run(`CREATE TRIGGER IF NOT EXISTS update_settings_timestamp 
                AFTER UPDATE ON settings
                BEGIN
                    UPDATE settings SET updated_at = CURRENT_TIMESTAMP
                    WHERE key = NEW.key;
                END`);

        // Create update trigger for tool_configs
        db.run(`CREATE TRIGGER IF NOT EXISTS update_tool_configs_timestamp 
                AFTER UPDATE ON tool_configs
                BEGIN
                    UPDATE tool_configs SET updated_at = CURRENT_TIMESTAMP
                    WHERE id = NEW.id;
                END`);

        // Initialize default tool configurations
        const defaultTools = [
            {
                name: 'weather',
                configs: {
                    is_enabled: true,
                    api_key: ''
                }
            },
            {
                name: 'google_search',
                configs: {
                    is_enabled: true,
                    api_key: ''
                }
            },
            {
                name: 'elevenlabs_tts',
                configs: {
                    is_enabled: true,
                    api_key: '',
                    voice_id: ''
                }
            }
        ];

        // Insert default tool configurations
        defaultTools.forEach(tool => {
            // Set the enabled state
            db.run(
                `INSERT OR REPLACE INTO tool_configs (tool_name, config_key, is_enabled)
                 VALUES (?, 'is_enabled', ?)`,
                [tool.name, tool.configs.is_enabled ? 1 : 0]
            );

            // Set other configurations
            Object.entries(tool.configs).forEach(([key, value]) => {
                if (key !== 'is_enabled') {
                    db.run(
                        `INSERT OR REPLACE INTO tool_configs (tool_name, config_key, config_value)
                         VALUES (?, ?, ?)`,
                        [tool.name, key, value.toString()]
                    );
                }
            });
        });

        // Initialize default personalities
        const defaultPersonalities = [
            {
                name: 'Normal',
                system_prompt: 'You are a helpful AI assistant.',
                is_builtin: 1,
                is_default: 1
            },
            {
                name: 'Concise',
                system_prompt: 'You are a helpful AI assistant. Be concise and to the point.',
                is_builtin: 1
            }
        ];

        // Insert default personalities
        defaultPersonalities.forEach(personality => {
            db.run(
                `INSERT OR REPLACE INTO personalities (name, system_prompt, is_builtin, is_default)
                 VALUES (?, ?, ?, ?)`,
                [personality.name, personality.system_prompt, personality.is_builtin, personality.is_default || 0]
            );
        });

        // Initialize default settings
        const defaultSettings = [
            { key: 'llm_api_endpoint', value: '' },
            { key: 'llm_model', value: '' },
            { key: 'llm_temperature', value: '0.7' },
            { key: 'llm_max_tokens', value: '1000' },
            { key: 'elevenlabs_api_key', value: null },
            { key: 'elevenlabs_voice_id', value: null },
            { key: 'elevenlabs_enabled', value: 'true' }
        ];

        defaultSettings.forEach(setting => {
            db.run(
                `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
                [setting.key, setting.value]
            );
        });

        console.log('Database schema and default data initialized successfully');
    } catch (error) {
        console.error('Error in database initialization:', error);
        process.exit(1);
    }
});

// Close the database connection
db.close((err) => {
    if (err) {
        console.error('Error closing database:', err);
        process.exit(1);
    }
    console.log('Frank database initialized successfully.');
}); 
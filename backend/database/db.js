import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { toolConfigMethods } from './toolConfigs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Database {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, 'Frank.db'));
        this.init();
        // Mix in tool configuration methods
        Object.assign(this, toolConfigMethods);
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Drop and recreate conversations table with summary column
                this.db.run(`DROP TABLE IF EXISTS conversations`);
                this.db.run(`
                    CREATE TABLE conversations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT,
                        summary TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Drop and recreate messages table with role instead of is_ai
                this.db.run(`DROP TABLE IF EXISTS messages`);
                this.db.run(`
                    CREATE TABLE messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conversation_id INTEGER,
                        content TEXT,
                        role TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                    )
                `);

                // Create settings table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT
                    )
                `);

                // Create tool_configs table
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS tool_configs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tool_name TEXT NOT NULL,
                        config_key TEXT NOT NULL,
                        config_value TEXT,
                        is_enabled BOOLEAN DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(tool_name, config_key)
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Create saved_configs table if it doesn't exist
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS saved_configs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        endpoint TEXT NOT NULL,
                        model TEXT NOT NULL,
                        temperature TEXT NOT NULL,
                        max_tokens TEXT NOT NULL,
                        elevenlabs_api_key TEXT,
                        elevenlabs_voice_id TEXT,
                        is_default BOOLEAN DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else {
                        // Create personalities table
                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS personalities (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                name TEXT NOT NULL UNIQUE,
                                system_prompt TEXT NOT NULL,
                                is_default BOOLEAN DEFAULT 0,
                                is_builtin BOOLEAN DEFAULT 0,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `, async (err) => {
                            if (err) {
                                console.error('Error creating personalities table:', err);
                                reject(err);
                            } else {
                                try {
                                    // Insert default personalities if they don't exist
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
                                        },
                                        {
                                            name: 'Formal',
                                            system_prompt: 'You are a helpful AI assistant. Maintain a formal and professional tone.',
                                            is_builtin: 1
                                        },
                                        {
                                            name: 'Sassy',
                                            system_prompt: 'You are a helpful but sassy AI assistant with attitude.',
                                            is_builtin: 1
                                        },
                                        {
                                            name: 'Pirate',
                                            system_prompt: 'You are a helpful AI assistant who speaks like a pirate. Use pirate slang and terminology.',
                                            is_builtin: 1
                                        }
                                    ];

                                    await new Promise((resolve, reject) => {
                                        this.db.run('BEGIN TRANSACTION', async (err) => {
                                            if (err) {
                                                console.error('Error starting transaction:', err);
                                                reject(err);
                                                return;
                                            }

                                            try {
                                                for (const personality of defaultPersonalities) {
                                                    await new Promise((res, rej) => {
                                                        this.db.run(
                                                            `INSERT INTO personalities (name, system_prompt, is_builtin, is_default) 
                                                             VALUES (?, ?, ?, ?)
                                                             ON CONFLICT(name) DO UPDATE SET
                                                             system_prompt = excluded.system_prompt,
                                                             is_builtin = excluded.is_builtin,
                                                             is_default = excluded.is_default
                                                             WHERE is_builtin = 1`,
                                                            [personality.name, personality.system_prompt, personality.is_builtin, personality.is_default || 0],
                                                            (err) => {
                                                                if (err) rej(err);
                                                                else res();
                                                            }
                                                        );
                                                    });
                                                }

                                                this.db.run('COMMIT', (err) => {
                                                    if (err) {
                                                        console.error('Error committing transaction:', err);
                                                        reject(err);
                                                    } else {
                                                        resolve();
                                                    }
                                                });
                                            } catch (error) {
                                                this.db.run('ROLLBACK', () => {
                                                    console.error('Transaction rolled back:', error);
                                                    reject(error);
                                                });
                                            }
                                        });
                                    });

                                    resolve();
                                } catch (error) {
                                    console.error('Error in personalities initialization:', error);
                                    reject(error);
                                }
                            }
                        });
                    }
                });
            });
        });
    }

    all(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    get(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    run(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(query, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    async getSettings() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT key, value FROM settings', [], (err, rows) => {
                if (err) {
                    console.error('Error fetching settings:', err);
                    reject(err);
                } else {
                    console.log('Raw settings from DB:', rows); // Debug log
                    
                    const settings = {
                        elevenlabs_api_key: null,
                        elevenlabs_voice_id: null,
                        llm_api_endpoint: '',
                        llm_model: '',
                        llm_temperature: 0.7,
                        llm_max_tokens: 1000
                    };
                    
                    rows.forEach(row => {
                        if (row.key === 'llm_temperature') {
                            settings[row.key] = parseFloat(row.value);
                        } else if (row.key === 'llm_max_tokens') {
                            settings[row.key] = parseInt(row.value);
                        } else {
                            settings[row.key] = row.value;
                        }
                    });
                    
                    console.log('Processed settings:', settings); // Debug log
                    resolve(settings);
                }
            });
        });
    }

    async updateSetting(key, value) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                [key, value],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async deleteSetting(key) {
        await this.run('UPDATE settings SET value = NULL WHERE key = ?', [key]);
    }

    async close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Create a new conversation
    createConversation(title) {
        return new Promise((resolve, reject) => {
            const query = `INSERT INTO conversations (title, created_at, updated_at) 
                         VALUES (?, datetime('now'), datetime('now'))`;
            const db = this.db;
            db.run(query, [title], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ 
                    id: this.lastID, 
                    title,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
            });
        });
    }

    // Add a message to a conversation
    addMessage(conversationId, role, content) {
        return new Promise((resolve, reject) => {
            const query = `INSERT INTO messages (conversation_id, role, content, created_at) 
                         VALUES (?, ?, ?, datetime('now'))`;
            const db = this.db;
            db.run(query, [conversationId, role, content], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ 
                    id: this.lastID, 
                    conversationId, 
                    role, 
                    content,
                    created_at: new Date().toISOString()
                });
            });
        });
    }

    // Get all conversations
    getConversations() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    c.id,
                    c.title,
                    c.created_at,
                    c.updated_at,
                    COUNT(m.id) as message_count,
                    MAX(m.created_at) as last_message_at
                FROM conversations c
                LEFT JOIN messages m ON c.id = m.conversation_id
                GROUP BY c.id
                ORDER BY c.updated_at DESC`;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Database error in getConversations:', err);
                    reject(err);
                    return;
                }
                
                // Handle case where no rows exist
                if (!rows) {
                    resolve([]);
                    return;
                }

                try {
                    // Format dates for each row
                    const formattedRows = rows.map(row => ({
                        ...row,
                        created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
                        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
                        last_message_at: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
                        title: row.title || 'New Conversation',
                        message_count: row.message_count || 0
                    }));
                    resolve(formattedRows);
                } catch (error) {
                    console.error('Error formatting conversation rows:', error);
                    // If formatting fails, return raw rows
                    resolve(rows);
                }
            });
        });
    }

    // Get a single conversation with its messages
    getConversation(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    c.id,
                    c.title,
                    c.created_at,
                    c.updated_at,
                    json_group_array(
                        CASE 
                            WHEN m.id IS NULL THEN json_object(
                                'id', NULL,
                                'role', NULL,
                                'content', NULL,
                                'created_at', NULL
                            )
                            ELSE json_object(
                                'id', m.id,
                                'role', m.role,
                                'content', m.content,
                                'created_at', m.created_at
                            )
                        END
                    ) as messages
                FROM conversations c
                LEFT JOIN messages m ON c.id = m.conversation_id
                WHERE c.id = ?
                GROUP BY c.id`;
            
            this.db.get(query, [id], (err, row) => {
                if (err) {
                    console.error('Database error in getConversation:', err);
                    reject(err);
                    return;
                }

                if (!row) {
                    resolve(null);
                    return;
                }

                try {
                    // Parse the messages JSON string and format dates
                    row.messages = JSON.parse(row.messages);
                    
                    // Filter out null messages and format dates
                    if (row.messages[0].id === null) {
                        row.messages = [];
                    } else {
                        row.messages = row.messages.map(msg => ({
                            ...msg,
                            created_at: msg.created_at ? new Date(msg.created_at).toISOString() : new Date().toISOString()
                        }));
                    }

                    // Format conversation dates
                    row.created_at = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();
                    row.updated_at = row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString();
                    row.title = row.title || 'New Conversation';
                    
                    resolve(row);
                } catch (error) {
                    console.error('Error formatting conversation:', error);
                    // If formatting fails, return raw row
                    resolve(row);
                }
            });
        });
    }

    // Update conversation's title and summary
    updateConversationTitle(id, title, summary) {
        return new Promise((resolve, reject) => {
            const query = `UPDATE conversations 
                         SET title = ?, 
                             summary = ?,
                             updated_at = datetime('now')
                         WHERE id = ?`;
            const db = this.db;
            db.run(query, [title, summary, id], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    // Update conversation's updated_at timestamp
    updateConversationTimestamp(id) {
        return new Promise((resolve, reject) => {
            const query = `UPDATE conversations 
                         SET updated_at = datetime('now')
                         WHERE id = ?`;
            const db = this.db;
            db.run(query, [id], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    // Get messages for summarization
    getMessagesForSummarization(conversationId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT content, role
                FROM messages
                WHERE conversation_id = ?
                ORDER BY created_at ASC
                LIMIT 10`; // Limit to first 10 messages for summary
            
            this.db.all(query, [conversationId], (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });
    }

    // Get messages for context
    getMessagesForContext(conversationId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT role, content
                FROM messages
                WHERE conversation_id = ?
                ORDER BY created_at ASC
                LIMIT 10`; // Limit to last 10 messages for context window
            
            this.db.all(query, [conversationId], (err, rows) => {
                if (err) {
                    console.error('Database error in getMessagesForContext:', err);
                    reject(err);
                    return;
                }
                resolve(rows || []);
            });
        });
    }

    // Add saved configs methods
    async getSavedConfigs() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM saved_configs ORDER BY created_at DESC',
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    async saveConfig({ name, endpoint, model, temperature, max_tokens, elevenlabs_api_key, elevenlabs_voice_id }) {
        return new Promise((resolve, reject) => {
            const db = this.db;
            this.db.serialize(() => {
                const stmt = this.db.prepare(
                    `INSERT INTO saved_configs (
                        name, endpoint, model, temperature, max_tokens, 
                        elevenlabs_api_key, elevenlabs_voice_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
                );

                stmt.run(
                    [name, endpoint, model, temperature, max_tokens, elevenlabs_api_key, elevenlabs_voice_id],
                    function(err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        const id = this.lastID;
                        db.get(
                            'SELECT * FROM saved_configs WHERE id = ?',
                            [id],
                            (err, row) => {
                                if (err) {
                                    reject(err);
                                } else if (!row) {
                                    reject(new Error('Failed to retrieve saved config'));
                                } else {
                                    resolve(row);
                                }
                            }
                        );
                    }
                );
            });
        });
    }

    async setDefaultConfig(id) {
        return new Promise((resolve, reject) => {
            console.log('Setting default config for id:', id);
            this.db.serialize(() => {
                // First, unset any existing default
                this.db.run('UPDATE saved_configs SET is_default = 0', [], (err) => {
                    if (err) {
                        console.error('Error unsetting previous default:', err);
                        reject(err);
                        return;
                    }
                    console.log('Unset previous default configs');

                    // Then set the new default
                    this.db.run(
                        'UPDATE saved_configs SET is_default = 1 WHERE id = ?',
                        [id],
                        (err) => {
                            if (err) {
                                console.error('Error setting new default:', err);
                                reject(err);
                                return;
                            }
                            console.log('Set new default config');

                            // Return the updated config
                            this.db.get(
                                'SELECT * FROM saved_configs WHERE id = ?',
                                [id],
                                (err, row) => {
                                    if (err) {
                                        console.error('Error fetching updated config:', err);
                                        reject(err);
                                    } else if (!row) {
                                        console.error('Config not found after setting default');
                                        reject(new Error('Config not found'));
                                    } else {
                                        console.log('Successfully set default config:', row);
                                        resolve(row);
                                    }
                                }
                            );
                        }
                    );
                });
            });
        });
    }

    async deleteConfig(id) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM saved_configs WHERE id = ?',
                [id],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ success: true });
                    }
                }
            );
        });
    }

    async updateConfig(id, config) {
        const { endpoint, model, temperature, max_tokens, elevenlabs_api_key, elevenlabs_voice_id } = config;
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE saved_configs 
                 SET endpoint = ?, 
                     model = ?, 
                     temperature = ?, 
                     max_tokens = ?,
                     elevenlabs_api_key = ?,
                     elevenlabs_voice_id = ?
                 WHERE id = ?`,
                [endpoint, model, temperature, max_tokens, elevenlabs_api_key, elevenlabs_voice_id, id],
                (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    this.db.get(
                        'SELECT * FROM saved_configs WHERE id = ?',
                        [id],
                        (err, row) => {
                            if (err) {
                                reject(err);
                            } else if (!row) {
                                reject(new Error('Config not found'));
                            } else {
                                resolve(row);
                            }
                        }
                    );
                }
            );
        });
    }

    // Delete a conversation and its messages
    deleteConversation(id) {
        return new Promise((resolve, reject) => {
            // Start a transaction to ensure both operations complete
            this.db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Delete messages first (due to foreign key constraint)
                this.db.run('DELETE FROM messages WHERE conversation_id = ?', [id], (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    // Then delete the conversation
                    this.db.run('DELETE FROM conversations WHERE id = ?', [id], (err) => {
                        if (err) {
                            this.db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        // Commit the transaction
                        this.db.run('COMMIT', (err) => {
                            if (err) {
                                this.db.run('ROLLBACK');
                                reject(err);
                                return;
                            }
                            resolve();
                        });
                    });
                });
            });
        });
    }

    // Add method to get the default config
    async getDefaultConfig() {
        return new Promise(async (resolve, reject) => {
            try {
                const defaultConfig = await this.get('SELECT * FROM saved_configs WHERE is_default = 1');
                
                if (defaultConfig) {
                    // Update settings with the default config values
                    await this.updateSetting('llm_api_endpoint', defaultConfig.endpoint);
                    await this.updateSetting('llm_model', defaultConfig.model);
                    await this.updateSetting('llm_temperature', defaultConfig.temperature);
                    await this.updateSetting('llm_max_tokens', defaultConfig.max_tokens);
                    if (defaultConfig.elevenlabs_api_key) {
                        await this.updateSetting('elevenlabs_api_key', defaultConfig.elevenlabs_api_key);
                    }
                    if (defaultConfig.elevenlabs_voice_id) {
                        await this.updateSetting('elevenlabs_voice_id', defaultConfig.elevenlabs_voice_id);
                    }
                }
                
                resolve(defaultConfig);
            } catch (error) {
                console.error('Error in getDefaultConfig:', error);
                reject(error);
            }
        });
    }

    // Personality management methods
    async getPersonalities() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM personalities ORDER BY created_at DESC', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async addPersonality({ name, system_prompt }) {
        return new Promise((resolve, reject) => {
            const db = this.db;
            this.db.serialize(() => {
                const stmt = this.db.prepare(
                    `INSERT INTO personalities (name, system_prompt) VALUES (?, ?)`
                );

                stmt.run([name, system_prompt], function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const id = this.lastID;
                    db.get(
                        'SELECT * FROM personalities WHERE id = ?',
                        [id],
                        (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        }
                    );
                });
            });
        });
    }

    async setDefaultPersonality(id) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // First, unset any existing default
                this.db.run('UPDATE personalities SET is_default = 0', [], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Then set the new default
                    this.db.run(
                        'UPDATE personalities SET is_default = 1 WHERE id = ?',
                        [id],
                        (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            // Return the updated personality
                            this.db.get(
                                'SELECT * FROM personalities WHERE id = ?',
                                [id],
                                (err, row) => {
                                    if (err) {
                                        reject(err);
                                    } else if (!row) {
                                        reject(new Error('Personality not found'));
                                    } else {
                                        resolve(row);
                                    }
                                }
                            );
                        }
                    );
                });
            });
        });
    }

    async deletePersonality(id) {
        return new Promise((resolve, reject) => {
            // Don't allow deletion of builtin personalities
            this.db.run(
                'DELETE FROM personalities WHERE id = ? AND is_builtin = 0',
                [id],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    async getDefaultPersonality() {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM personalities WHERE is_default = 1', [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Tool configuration methods
    async getToolConfigs() {
        const rows = await this.all('SELECT * FROM tool_configs');
        const configs = {};
        rows.forEach(row => {
            if (!configs[row.tool_name]) {
                configs[row.tool_name] = {
                    is_enabled: row.is_enabled
                };
            }
            configs[row.tool_name][row.config_key] = row.config_value;
        });
        return configs;
    }

    async updateToolConfig(toolName, configKey, configValue) {
        const query = `
            INSERT INTO tool_configs (tool_name, config_key, config_value, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(tool_name, config_key)
            DO UPDATE SET 
                config_value = excluded.config_value,
                updated_at = excluded.updated_at
        `;
        return this.run(query, [toolName, configKey, configValue]);
    }

    async setToolEnabled(toolName, isEnabled) {
        const query = `
            UPDATE tool_configs 
            SET is_enabled = ?, updated_at = datetime('now')
            WHERE tool_name = ?
        `;
        return this.run(query, [isEnabled ? 1 : 0, toolName]);
    }

    async deleteToolConfig(toolName, configKey) {
        return this.run(
            'DELETE FROM tool_configs WHERE tool_name = ? AND config_key = ?',
            [toolName, configKey]
        );
    }
}

export default new Database(); 
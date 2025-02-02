import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Database {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(path.join(__dirname, 'Frank.db'), (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    async initializeTables() {
        // Create settings table if it doesn't exist
        await this.run(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create saved_configs table if it doesn't exist
        await this.run(`
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

        // Create conversations table if it doesn't exist
        await this.run(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                summary TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create messages table if it doesn't exist
        await this.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
        `);
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
        const rows = await this.all('SELECT key, value FROM settings');
        return rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
    }

    async updateSetting(key, value) {
        await this.run(
            'UPDATE settings SET value = ?, updated_at = datetime("now") WHERE key = ?',
            [value, key]
        );
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
            this.db.run(query, [title], function(err) {
                if (err) reject(err);
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
            this.db.run(query, [conversationId, role, content], function(err) {
                if (err) reject(err);
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
                    c.summary,
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
                    c.summary,
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
            this.db.run(query, [title, summary, id], (err) => {
                if (err) reject(err);
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
            this.db.run(query, [id], (err) => {
                if (err) reject(err);
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
        return this.all('SELECT * FROM saved_configs ORDER BY created_at DESC LIMIT 10');
    }

    async saveLLMConfig(config) {
        const { name, endpoint, model, temperature, max_tokens } = config;
        const result = await this.run(
            'INSERT INTO saved_configs (name, endpoint, model, temperature, max_tokens) VALUES (?, ?, ?, ?, ?)',
            [name, endpoint, model, temperature, max_tokens]
        );
        return this.get('SELECT * FROM saved_configs WHERE id = ?', [result.lastID]);
    }

    async deleteSavedConfig(id) {
        return this.run('DELETE FROM saved_configs WHERE id = ?', [id]);
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
}

export default new Database(); 
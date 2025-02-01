const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.db = new sqlite3.Database(
            path.join(__dirname, 'conversations.db'),
            sqlite3.OPEN_READWRITE,
            (err) => {
                if (err) {
                    console.error('Error opening database:', err);
                }
            }
        );
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
}

module.exports = new Database(); 
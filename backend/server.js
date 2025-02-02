import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import axios from 'axios';
import dotenv from 'dotenv';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import db from './database/db.js';
import chalk from 'chalk';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const server = createServer(app);

// Configure CORS for both HTTP and WebSocket
const corsOptions = {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'Connection', 'Upgrade', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
};

// Apply CORS middleware
app.use(cors(corsOptions));
app.use(express.json());

// Handle preflight requests
app.options('*', cors(corsOptions));

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (!corsOptions.origin.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
    }
});

// Create WebSocket server with CORS validation and better configuration
const wss = new WebSocketServer({ 
    server,
    verifyClient: ({ origin, req }, callback) => {
        const isAllowed = corsOptions.origin.includes(origin);
        callback(isAllowed);
    },
    clientTracking: true,
    // Increase timeout values
    handleProtocols: () => 'json',
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
        },
        zlibInflateOptions: {
            chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
    }
});

// Keep track of all connections
const clients = new Set();

// WebSocket server error handling
wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
});

// Constants
const PYTHON_SERVER_URL = process.env.PYTHON_SERVER_URL || 'http://localhost:8000';
let ELEVENLABS_API_KEY;
let ELEVENLABS_VOICE_ID;
let LLM_API_ENDPOINT;
const PORT = process.env.PORT || 3001;

// Custom logger
const logger = {
    info: (msg) => console.log(chalk.magenta(`[Express] ${msg}`)),
    error: (msg) => console.log(chalk.red(`[Express Error] ${msg}`)),
    warn: (msg) => console.log(chalk.yellow(`[Express Warning] ${msg}`)),
    success: (msg) => console.log(chalk.green(`[Express] ${msg}`))
};

// Initialize database connection
try {
    await db.init();
    logger.success('Connected to Frank database.');
} catch (error) {
    logger.error('Failed to connect to database: ' + error);
    process.exit(1);
}

// Load settings from database
async function loadSettings() {
    try {
        const settings = await db.getSettings();
        
        // Only validate LLM endpoint and model as they're mandatory
        if (!settings.llm_api_endpoint || !settings.llm_model) {
            console.error('Missing required settings:');
            if (!settings.llm_api_endpoint) console.error('- LLM API Endpoint');
            if (!settings.llm_model) console.error('- LLM Model');
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error loading settings:', error);
        return false;
    }
}

// Load settings before starting server
loadSettings().then((settingsValid) => {
    if (!settingsValid) {
        logger.warn('Please configure the required settings through the web interface.');
    }
    server.listen(PORT, () => {
        logger.info(`Server is running on port ${PORT}`);
    });
}).catch(error => {
    logger.error('Failed to start server: ' + error);
    process.exit(1);
});

// Add request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

// Update conversation endpoints
app.get('/conversations', async (req, res) => {
    try {
        const conversations = await db.getConversations();
        res.json(conversations);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

app.post('/conversations', async (req, res) => {
    try {
        const { title } = req.body;
        const defaultTitle = `Conversation ${Date.now()}`;
        const conversation = await db.createConversation(title || defaultTitle);
        res.status(201).json(conversation);
    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({ error: 'Failed to create conversation' });
    }
});

app.get('/conversations/:id', async (req, res) => {
    try {
        const conversation = await db.getConversation(parseInt(req.params.id));
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.json(conversation);
    } catch (error) {
        console.error('Error fetching conversation:', error);
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

// Add DELETE endpoint for conversations
app.delete('/conversations/:id', async (req, res) => {
    try {
        const conversationId = parseInt(req.params.id);
        await db.deleteConversation(conversationId);
        res.status(200).json({ message: 'Conversation deleted successfully' });
    } catch (error) {
        console.error('Error deleting conversation:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

// Settings endpoints
app.get('/settings', async (req, res) => {
    try {
        const settings = await db.getSettings();
        res.json(settings);
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

app.post('/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        await db.updateSetting(key, value);
        res.status(200).json({ message: 'Setting updated successfully' });
    } catch (error) {
        console.error('Error updating setting:', error);
        res.status(500).json({ error: 'Failed to update setting' });
    }
});

app.delete('/settings/:key', async (req, res) => {
    try {
        await db.deleteSetting(req.params.key);
        res.status(200).json({ message: 'Setting deleted successfully' });
    } catch (error) {
        console.error('Error deleting setting:', error);
        res.status(500).json({ error: 'Failed to delete setting' });
    }
});

// Update saved configs endpoints to use the new methods
app.get('/saved-configs', async (req, res) => {
  try {
    const configs = await db.getSavedConfigs();
    res.json(configs || []);
  } catch (error) {
    console.error('Error fetching saved configs:', error);
    res.status(500).json({ error: 'Failed to fetch saved configurations' });
  }
});

app.post('/saved-configs', async (req, res) => {
  const { name, endpoint, model, temperature, max_tokens } = req.body;
  
  if (!name || !endpoint || !model || !temperature || !max_tokens) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    const savedConfig = await db.saveLLMConfig({ name, endpoint, model, temperature, max_tokens });
    res.json(savedConfig);
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

app.delete('/saved-configs/:id', async (req, res) => {
  try {
    await db.deleteSavedConfig(parseInt(req.params.id));
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting config:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

// Connection handling
wss.on('connection', (ws, req) => {
    logger.info(`Client connected from ${req.socket.remoteAddress}`);
    clients.add(ws);
    
    // Set up ping-pong to keep connection alive
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    let currentConversationId = null;

    // Handle incoming messages
    ws.on('message', async (message) => {
        try {
            // Reset alive status on any message
            ws.isAlive = true;

            let jsonData;
            try {
                const strMessage = message.toString();
                jsonData = JSON.parse(strMessage);

                // Handle conversation selection
                if (jsonData.type === 'select_conversation') {
                    currentConversationId = jsonData.conversationId;
                    // Send confirmation back to client
                    ws.send(JSON.stringify({
                        type: 'conversation_selected',
                        conversationId: currentConversationId
                    }));
                    return;
                }

                // Handle debug messages
                if (jsonData.type === 'debug') {
                    console.log('Received debug message:', jsonData);
                    
                    // For debug transcription, only send back the transcription without LLM/TTS
                    if (jsonData.action === 'transcribe') {
                        const response = await axios.post(`${PYTHON_SERVER_URL}/transcribe`, jsonData.audio, {
                            headers: {
                                'Content-Type': 'application/octet-stream'
                            },
                            responseType: 'json'
                        });
                        
                        if (response.data && response.data.transcription) {
                            ws.send(JSON.stringify({
                                type: 'debug',
                                action: 'transcription',
                                text: response.data.transcription
                            }));
                        }
                        return;
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'status',
                        status: 'Debug mode: ' + jsonData.action
                    }));
                    return;
                }
            } catch (e) {
                // Handle binary message (audio data)
                if (!(message instanceof Buffer)) {
                    throw new Error('Invalid message format');
                }

                // Skip processing for small control messages
                if (message.length <= 50) {
                    return;
                }

                // Create new conversation if none selected
                if (!currentConversationId) {
                    const conversation = await db.createConversation(`New Conversation`);
                    currentConversationId = conversation.id;
                    // Notify client of new conversation
                    ws.send(JSON.stringify({
                        type: 'new_conversation',
                        conversation: conversation
                    }));
                }

                // Process transcription
                const response = await axios.post(`${PYTHON_SERVER_URL}/transcribe`, message, {
                    headers: {
                        'Content-Type': 'application/octet-stream'
                    },
                    responseType: 'json'
                });

                if (response.data && response.data.transcription) {
                    const transcription = response.data.transcription;
                    
                    // Save user message
                    await db.addMessage(currentConversationId, 'user', transcription);
                    
                    // Send transcription to client
                    ws.send(JSON.stringify({
                        type: 'transcription',
                        text: transcription
                    }));

                    // Get and save AI response
                    const llmResponse = await getLLMResponse(transcription, currentConversationId);
                    await db.addMessage(currentConversationId, 'assistant', llmResponse);
                    
                    // Generate summary after a few messages
                    const messages = await db.getMessagesForSummarization(currentConversationId);
                    if (messages.length >= 2) { // Update summary after at least one exchange
                        const summary = await generateConversationSummary(messages);
                        if (summary) {
                            const now = new Date();
                            const formattedDate = now.toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                            }).replace(',', '');
                            const title = `${summary} - ${formattedDate}`;
                            await db.updateConversationTitle(currentConversationId, title, summary);
                        }
                    }
                    
                    // Update conversation timestamp
                    await db.updateConversationTimestamp(currentConversationId);
                    
                    // Send LLM response to client
                    ws.send(JSON.stringify({
                        type: 'ai_response',
                        text: llmResponse
                    }));

                    // Get TTS response
                    const audioResponse = await getTextToSpeech(llmResponse);
                    
                    // Send audio response to client
                    ws.send(Buffer.from(audioResponse));
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
            // Send error to client only if connection is still open
            if (ws.readyState === WebSocketServer.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: error.message || 'An unexpected error occurred'
                }));
            }
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        logger.info(`Client disconnected from ${req.socket.remoteAddress}`);
        clients.delete(ws);
        ws.isAlive = false;
    });

    // Handle errors
    ws.on('error', (error) => {
        logger.error('WebSocket client error: ' + error);
        clients.delete(ws);
        ws.isAlive = false;
    });

    // Send initial connection success message
    ws.send(JSON.stringify({
        type: 'connection_established',
        message: 'Connected to server'
    }));
});

// Set up ping interval to keep connections alive
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            clients.delete(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 30000);

// Clean up interval on server close
server.on('close', () => {
    clearInterval(pingInterval);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        services: {
            express: 'running',
            python: PYTHON_SERVER_URL
        }
    });
});

// Update error handling middleware
app.use((err, req, res, next) => {
    logger.error(err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Add error event handler for the server
server.on('error', (error) => {
    logger.error('HTTP server error: ' + error);
});

// Helper function to get LLM response
async function getLLMResponse(text, conversationId) {
    try {
        const settings = await db.getSettings();
        
        // Get previous messages from the conversation for context
        const previousMessages = await db.getMessagesForContext(conversationId);
        
        // Build the messages array with conversation history
        const messages = [
            { role: "system", content: "You are a helpful AI assistant. Keep responses concise and natural." },
            ...previousMessages.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            })),
            { role: "user", content: text }
        ];

        // Use the chat completions endpoint
        const response = await axios.post(`${settings.llm_api_endpoint}/v1/chat/completions`, {
            messages,
            model: settings.llm_model,
            temperature: settings.llm_temperature ? parseFloat(settings.llm_temperature) : 0.7,
            max_tokens: settings.llm_max_tokens ? parseInt(settings.llm_max_tokens) : 1000
        });

        // Extract the response text from the API response
        if (response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message) {
            return response.data.choices[0].message.content;
        }
        
        throw new Error('Invalid response format from LLM API');
    } catch (error) {
        console.error('LLM error:', error.message);
        throw error;
    }
}

// Helper function to get TTS response
async function getTextToSpeech(text) {
    try {
        const settings = await db.getSettings();
        if (!settings.elevenlabs_api_key || !settings.elevenlabs_voice_id) {
            console.log('ElevenLabs settings not configured, skipping TTS');
            return null;
        }

        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${settings.elevenlabs_voice_id}`,
            {
                text,
                model_id: "eleven_monolingual_v1",
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5
                }
            },
            {
                headers: {
                    'Accept': 'audio/mpeg',
                    'xi-api-key': settings.elevenlabs_api_key,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            }
        );

        return response.data;
    } catch (error) {
        console.error('TTS error:', error.message);
        throw error;
    }
}

// Helper function to generate conversation summary
async function generateConversationSummary(messages) {
    if (!messages || messages.length === 0) return null;

    const conversationText = messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');

    try {
        const settings = await db.getSettings();
        const response = await axios.post(`${settings.llm_api_endpoint}/v1/chat/completions`, {
            messages: [
                { 
                    role: "system", 
                    content: "You are a helpful AI assistant. Generate a very brief, 2-4 word topic or action that summarizes this conversation. Focus on the key subject or action. Respond ONLY with the summary words, no punctuation or extra text. Example responses: 'Weather Forecast Discussion' or 'Schedule Meeting' or 'Python Code Help'" 
                },
                { role: "user", content: conversationText }
            ],
            model: settings.llm_model,
            temperature: settings.llm_temperature ? parseFloat(settings.llm_temperature) : 0.7,
            max_tokens: settings.llm_max_tokens ? parseInt(settings.llm_max_tokens) : 20
        });

        if (response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message) {
            return response.data.choices[0].message.content.trim();
        }
        
        throw new Error('Invalid response format from LLM API');
    } catch (error) {
        console.error('Summary generation error:', error.message);
        return 'New Conversation';
    }
} 
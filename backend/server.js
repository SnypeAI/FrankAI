const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const axios = require('axios');
const dotenv = require('dotenv');
const { createServer } = require('http');
const path = require('path');
const db = require('./database/db');

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const server = createServer(app);

// Configure CORS for both HTTP and WebSocket
const corsOptions = {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
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
const wss = new WebSocket.Server({ 
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
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const LLM_API_ENDPOINT = process.env.LLM_API_ENDPOINT;
const PORT = process.env.PORT || 3001;

// Validate required environment variables
if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID || !LLM_API_ENDPOINT) {
    console.error('Missing required environment variables:');
    if (!ELEVENLABS_API_KEY) console.error('- ELEVENLABS_API_KEY');
    if (!ELEVENLABS_VOICE_ID) console.error('- ELEVENLABS_VOICE_ID');
    if (!LLM_API_ENDPOINT) console.error('- LLM_API_ENDPOINT');
    process.exit(1);
}

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
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

// Helper function to get LLM response
async function getLLMResponse(text) {
    try {
        const response = await axios.post(LLM_API_ENDPOINT, {
            messages: [
                { role: "system", content: "You are a helpful AI assistant. Keep responses concise and natural." },
                { role: "user", content: text }
            ],
            model: "llama-3.1-8b-lexi-uncensored-v2",
            temperature: 0.7,
            max_tokens: 1000
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('LLM error:', error.message);
        throw error;
    }
}

// Helper function to get TTS response
async function getTextToSpeech(text) {
    try {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
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
                    'xi-api-key': ELEVENLABS_API_KEY,
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
        const response = await axios.post(LLM_API_ENDPOINT, {
            messages: [
                { 
                    role: "system", 
                    content: "You are a helpful AI assistant. Generate a very brief, 2-4 word topic or action that summarizes this conversation. Focus on the key subject or action. Respond ONLY with the summary words, no punctuation or extra text. Example responses: 'Weather Forecast Discussion' or 'Schedule Meeting' or 'Python Code Help'" 
                },
                { role: "user", content: conversationText }
            ],
            model: "llama-3.1-8b-lexi-uncensored-v2",
            temperature: 0.7,
            max_tokens: 20
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Summary generation error:', error.message);
        return 'New Conversation';
    }
}

// Connection handling
wss.on('connection', (ws, req) => {
    console.log(`Client connected from ${req.socket.remoteAddress}`);
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
                    const llmResponse = await getLLMResponse(transcription);
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
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: error.message || 'An unexpected error occurred'
                }));
            }
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`Client disconnected from ${req.socket.remoteAddress}`);
        clients.delete(ws);
        ws.isAlive = false;
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket client error:', error);
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

// Error handling middleware (place this before routes)
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Add error event handler for the server
server.on('error', (error) => {
    console.error('HTTP server error:', error);
});

// Update the server start to include more logging
server.listen(PORT, () => {
    console.log(`Server started at ${new Date().toISOString()}`);
    console.log(`Express server listening on port ${PORT}`);
    console.log(`WebSocket server is running`);
    console.log(`CORS enabled for origins:`, corsOptions.origin);
    console.log(`Python server URL: ${PYTHON_SERVER_URL}`);
}); 
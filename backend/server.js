const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const axios = require('axios');
const dotenv = require('dotenv');
const { createServer } = require('http');
const path = require('path');

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const server = createServer(app);

// Configure CORS for both HTTP and WebSocket
const corsOptions = {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Create WebSocket server with CORS validation
const wss = new WebSocket.Server({ 
    server,
    verifyClient: ({ origin }) => {
        return corsOptions.origin.includes(origin);
    }
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

// In-memory store for conversations (replace with database in production)
const conversations = [];

// Conversations endpoints
app.get('/conversations', (req, res) => {
    res.json(conversations);
});

app.post('/conversations', (req, res) => {
    const { title } = req.body;
    const conversation = {
        id: Date.now(),
        title: title || `Conversation ${conversations.length + 1}`,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
    };
    conversations.push(conversation);
    res.status(201).json(conversation);
});

app.get('/conversations/:id', (req, res) => {
    const conversation = conversations.find(c => c.id === parseInt(req.params.id));
    if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
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

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {
        try {
            // Try to parse as JSON first
            let jsonData;
            try {
                const strMessage = message.toString();
                jsonData = JSON.parse(strMessage);
                
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
                // Not JSON, check if it's audio data
                if (!(message instanceof Buffer)) {
                    throw new Error('Invalid message format');
                }

                // Skip processing for small control messages
                if (message.length <= 50) {
                    console.log('Received control message, skipping processing');
                    return;
                }

                console.log('Processing audio data:', message.length, 'bytes');
                
                // Forward the audio data to the Python server for transcription
                const response = await axios.post(`${PYTHON_SERVER_URL}/transcribe`, message, {
                    headers: {
                        'Content-Type': 'application/octet-stream'
                    },
                    responseType: 'json'
                });

                if (response.data && response.data.transcription) {
                    const transcription = response.data.transcription;
                    
                    // Send transcription back to client
                    ws.send(JSON.stringify({
                        type: 'transcription',
                        text: transcription
                    }));

                    // Get LLM response
                    const llmResponse = await getLLMResponse(transcription);
                    
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
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message || 'An unexpected error occurred'
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
    console.log(`Python server URL: ${PYTHON_SERVER_URL}`);
}); 
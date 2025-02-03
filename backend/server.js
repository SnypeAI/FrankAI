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
import { ToolManager } from '../tools/toolManager.js';

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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'Origin',
        'Connection',
        'Upgrade',
        'Sec-WebSocket-Key',
        'Sec-WebSocket-Version',
        'Sec-WebSocket-Extensions'
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
};

// Apply CORS middleware
app.use(cors(corsOptions));
app.use(express.json());

// Handle preflight requests
app.options('*', cors(corsOptions));

// Create WebSocket server
const wss = new WebSocketServer({ 
    server,
    path: '/ws',
    verifyClient: ({ origin }, callback) => {
        const isAllowed = !origin || corsOptions.origin.includes(origin);
        callback(isAllowed);
    },
    clientTracking: true,
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

// Initialize tool manager
const toolManager = new ToolManager(db);
await toolManager.initialize();

// Load settings from database
async function loadSettings() {
    try {
        // First try to load the default config
        const defaultConfig = await db.getDefaultConfig();
        if (defaultConfig) {
            console.log('Loaded default config:', defaultConfig);
        }
        
        // Then get the settings (which should now include the default config values)
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
        res.json({ success: true });
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

// Update saved configs endpoints
app.get('/saved-configs', async (req, res) => {
  try {
    const configs = await db.getSavedConfigs();
    res.json(configs);
  } catch (error) {
    console.error('Error getting saved configs:', error);
    res.status(500).json({ error: 'Failed to get saved configs' });
  }
});

// Add endpoint to get default config
app.get('/saved-configs/default', async (req, res) => {
  try {
    const config = await db.getDefaultConfig();
    res.json(config || null); // Return null if no default config exists
  } catch (error) {
    console.error('Error getting default config:', error);
    res.status(500).json({ error: 'Failed to get default config' });
  }
});

// Add endpoint to set default config
app.post('/saved-configs/:id/set-default', async (req, res) => {
  try {
    const { id } = req.params;
    const config = await db.setDefaultConfig(id);
    res.json(config);
  } catch (error) {
    console.error('Error setting default config:', error);
    res.status(500).json({ error: 'Failed to set default config' });
  }
});

app.post('/saved-configs', async (req, res) => {
  try {
    const { 
      name, 
      endpoint, 
      model, 
      temperature, 
      max_tokens,
      elevenlabs_api_key,
      elevenlabs_voice_id
    } = req.body;
    
    const config = await db.saveConfig({ 
      name, 
      endpoint, 
      model, 
      temperature, 
      max_tokens,
      elevenlabs_api_key,
      elevenlabs_voice_id
    });
    res.json(config);
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

app.delete('/saved-configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteConfig(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting config:', error);
    res.status(500).json({ error: 'Failed to delete config' });
  }
});

// Add PUT route for updating configs
app.put('/saved-configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      endpoint, 
      model, 
      temperature, 
      max_tokens,
      elevenlabs_api_key,
      elevenlabs_voice_id
    } = req.body;
    
    const config = await db.updateConfig(id, { 
      endpoint, 
      model, 
      temperature, 
      max_tokens,
      elevenlabs_api_key,
      elevenlabs_voice_id
    });
    res.json(config);
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// Add tool configuration endpoints
app.get('/api/tool-configs', async (req, res) => {
    try {
        const configs = await db.getToolConfigs();
        res.json(configs);
    } catch (error) {
        console.error('Error fetching tool configs:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tool-configs/:toolName/:configKey', async (req, res) => {
    try {
        const { toolName, configKey } = req.params;
        const { value } = req.body;
        await toolManager.updateToolConfig(toolName, configKey, value);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating tool config:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tool-configs/:toolName/enabled', async (req, res) => {
    try {
        const { toolName } = req.params;
        const { enabled } = req.body;
        await toolManager.setToolEnabled(toolName, enabled);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating tool enabled state:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add tool execution endpoint
app.post('/api/execute-tool/:toolName', async (req, res) => {
    try {
        const { toolName } = req.params;
        const params = req.body;
        const result = await toolManager.executeTool(toolName, params);
        res.json(result);
    } catch (error) {
        console.error('Error executing tool:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update chat completion endpoint to include tools
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, conversation_id } = req.body;
        
        // Get available tools
        const tools = toolManager.getAvailableTools();
        
        // Get current settings
        const settings = await db.getSettings();
        
        // Get personality
        const personality = await db.getDefaultPersonality();
        
        // Prepare system message with personality and tools
        const systemMessage = {
            role: 'system',
            content: personality ? personality.system_prompt : 'You are a helpful AI assistant.'
        };
        
        // Make API request with tools if available
        const apiRequestBody = {
            model: settings.llm_model,
            messages: [systemMessage, ...messages],
            temperature: parseFloat(settings.llm_temperature),
            max_tokens: parseInt(settings.llm_max_tokens),
            ...(tools.length > 0 && { tools }),
            tool_choice: 'auto'
        };

        const response = await fetch(settings.llm_api_endpoint + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(apiRequestBody)
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Handle tool calls if present
        if (data.choices[0].message.tool_calls) {
            const toolCalls = data.choices[0].message.tool_calls;
            const toolResults = await Promise.all(toolCalls.map(async (toolCall) => {
                try {
                    const result = await toolManager.executeTool(
                        toolCall.function.name,
                        JSON.parse(toolCall.function.arguments)
                    );
                    return {
                        tool_call_id: toolCall.id,
                        role: 'tool',
                        content: JSON.stringify(result)
                    };
                } catch (error) {
                    console.error('Tool execution error:', error);
                    return {
                        tool_call_id: toolCall.id,
                        role: 'tool',
                        content: JSON.stringify({ error: error.message })
                    };
                }
            }));

            // Add tool calls and results to conversation
            if (conversation_id) {
                await db.addMessage(conversation_id, 'assistant', JSON.stringify(data.choices[0].message));
                for (const result of toolResults) {
                    await db.addMessage(conversation_id, 'tool', result.content);
                }
            }

            // Get final response with tool results
            const finalResponse = await fetch(settings.llm_api_endpoint + '/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: settings.llm_model,
                    messages: [
                        systemMessage,
                        ...messages,
                        data.choices[0].message,
                        ...toolResults
                    ],
                    temperature: parseFloat(settings.llm_temperature),
                    max_tokens: parseInt(settings.llm_max_tokens)
                })
            });

            if (!finalResponse.ok) {
                throw new Error(`API request failed: ${finalResponse.statusText}`);
            }

            const finalData = await finalResponse.json();
            
            // Save final response to conversation
            if (conversation_id) {
                await db.addMessage(conversation_id, 'assistant', finalData.choices[0].message.content);
            }

            res.json(finalData);
        } else {
            // No tool calls, just save and return the response
            if (conversation_id) {
                await db.addMessage(conversation_id, 'assistant', data.choices[0].message.content);
            }
            res.json(data);
        }
    } catch (error) {
        console.error('Error in chat endpoint:', error);
        res.status(500).json({ error: error.message });
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

                // Handle text messages
                if (jsonData.type === 'message') {
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

                    // Save user message
                    await db.addMessage(currentConversationId, 'user', jsonData.content);

                    // Get and save AI response
                    const llmResponse = await getLLMResponse(jsonData.content, currentConversationId);
                    await db.addMessage(currentConversationId, 'assistant', llmResponse);

                    // Generate summary after a few messages
                    const messages = await db.getMessagesForSummarization(currentConversationId);
                    if (messages.length >= 2) {
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

                    // Send AI response to client
                    ws.send(JSON.stringify({
                        type: 'ai_response',
                        text: llmResponse
                    }));

                    // Get TTS response
                    const audioResponse = await getTextToSpeech(llmResponse);
                    
                    // Only send audio response if TTS was successful
                    if (audioResponse) {
                        ws.send(JSON.stringify({
                            type: 'tts_response',
                            audio: Array.from(audioResponse)
                        }));
                    }
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

                // Handle saved configs
                if (jsonData.type === 'get_saved_configs') {
                    const configs = await db.getSavedConfigs();
                    ws.send(JSON.stringify({
                        type: 'saved_configs',
                        configs
                    }));
                    return;
                }

                // Handle personalities
                if (jsonData.type === 'get_personalities') {
                    const personalities = await db.getPersonalities();
                    ws.send(JSON.stringify({
                        type: 'personalities',
                        personalities
                    }));
                    return;
                }

                if (jsonData.type === 'add_personality') {
                    const personality = await db.addPersonality({
                        name: jsonData.name,
                        system_prompt: jsonData.system_prompt
                    });
                    ws.send(JSON.stringify({
                        type: 'personality_added',
                        personality
                    }));
                    return;
                }

                if (jsonData.type === 'set_default_personality') {
                    const personality = await db.setDefaultPersonality(jsonData.id);
                    ws.send(JSON.stringify({
                        type: 'personality_default_set',
                        personality
                    }));
                    return;
                }

                if (jsonData.type === 'delete_personality') {
                    const success = await db.deletePersonality(jsonData.id);
                    ws.send(JSON.stringify({
                        type: 'personality_deleted',
                        success,
                        id: jsonData.id
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
                    
                    // Only send audio response if TTS was successful
                    if (audioResponse) {
                        ws.send(JSON.stringify({
                            type: 'tts_response',
                            audio: Array.from(audioResponse)
                        }));
                    }
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

// Get and save AI response
const getLLMResponse = async (userMessage, conversationId) => {
    try {
        // Get conversation history for context
        const messages = await db.getMessagesForContext(conversationId);
        const settings = await db.getSettings();
        const defaultPersonality = await db.getDefaultPersonality();

        // Prepare messages array for API call
        const apiMessages = [
            // Add system message if there's a default personality
            ...(defaultPersonality ? [{ role: 'system', content: defaultPersonality.system_prompt }] : []),
            // Add conversation history
            ...messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            // Add current user message
            { role: 'user', content: userMessage }
        ];

        // Make API call
        const response = await axios.post(settings.llm_api_endpoint + '/v1/chat/completions', {
            model: settings.llm_model,
            messages: apiMessages,
            temperature: parseFloat(settings.llm_temperature),
            max_tokens: parseInt(settings.llm_max_tokens),
            stream: false
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error getting LLM response:', error);
        return 'Sorry, I encountered an error while processing your request.';
    }
};

// Helper function to get TTS response
async function getTextToSpeech(text) {
    try {
        const settings = await db.getSettings();
        const toolConfigs = await db.getToolConfigs();
        
        // Check if ElevenLabs is enabled in tool configs
        if (!toolConfigs.elevenlabs?.is_enabled) {
            console.log('ElevenLabs is disabled, skipping TTS');
            return null;
        }

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
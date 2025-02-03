'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Mic, MicOff, Menu, X, MessageSquare, Bug, Play, RefreshCw, Wand2, Volume2, Settings2, Keyboard, Send, Ear, CheckCircle2, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import DebugPanel from './DebugPanel';
import SettingsPanel from './SettingsPanel';
import ConversationHistory from './ConversationHistory';

interface ChatMessage {
  id: number;
  text: string;
  isAI: boolean;
  isStreaming: boolean;
}

interface Conversation {
  id: number;
  title: string;
  updated_at: string;
  message_count: number;
}

interface AudioState {
  isListening: boolean;
  isInitialized: boolean;
  wsConnected: boolean;
  error: string | null;
}

interface DebugState {
  recordedAudio: Uint8Array | null;
  lastTranscription: string | null;
  lastLLMResponse: string | null;
  lastTTSAudio: Uint8Array | null;
  debugStatus: string;
  isRecordingTest: boolean;
}

interface Settings {
  elevenlabs_api_key: string | null;
  elevenlabs_voice_id: string | null;
  llm_api_endpoint: string;
  llm_model: string;
  llm_temperature: number;
  llm_max_tokens: number;
  elevenlabs_enabled: string;
}

interface ModelFilters {
  showUncensored: boolean;
  modelFamily: string;
  sizeRange: string;
  sortBy: 'name' | 'size';
  sortDirection: 'asc' | 'desc';
}

interface LLMModel {
  id: string;
  name?: string;
  object: string;
  owned_by: string;
  size?: number;  // Size in billions of parameters
  family?: string;
}

interface SavedConfig {
  id: number;
  name: string;
  endpoint: string;
  model: string;
  temperature: string;
  max_tokens: string;
  created_at: string;
}

interface Personality {
  id: number;
  name: string;
  system_prompt: string;
  is_default: boolean;
  is_builtin: boolean;
  created_at: string;
}

// Input mode types
type InputMode = 'text' | 'push-to-talk' | 'trigger-word';

const VoiceAssistant = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<number | null>(null);
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [currentPersonality, setCurrentPersonality] = useState<Personality | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    elevenlabs_api_key: null,
    elevenlabs_voice_id: null,
    llm_api_endpoint: '',
    llm_model: '',
    llm_temperature: 0.7,
    llm_max_tokens: 1000,
    elevenlabs_enabled: 'true'
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [audioState, setAudioState] = useState<AudioState>({
    isListening: false,
    isInitialized: false,
    wsConnected: false,
    error: null
  });
  const [status, setStatus] = useState<string>('');
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false);
  const [debugState, setDebugState] = useState<DebugState>({
    recordedAudio: null,
    lastTranscription: null,
    lastLLMResponse: null,
    lastTTSAudio: null,
    debugStatus: '',
    isRecordingTest: false
  });
  const [availableModels, setAvailableModels] = useState<LLMModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const audioContext = useRef<AudioContext | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const audioProcessor = useRef<AudioWorkletNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const processingRef = useRef(false);
  const audioChunks = useRef<Uint8Array[]>([]);
  const isPlaying = useRef(false);
  const connectionAttempts = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const SILENCE_THRESHOLD = 0.01;  // Threshold for silence detection
  const MIN_AUDIO_DURATION = 0.5;  // Minimum duration in seconds
  const MAX_AUDIO_DURATION = 10;   // Maximum duration in seconds
  const SILENCE_DURATION = 0.7;    // Duration of silence to trigger processing

  const debugAudioProcessor = useRef<AudioWorkletNode | null>(null);
  const debugAudioStream = useRef<MediaStream | null>(null);

  // Add new state for active settings
  const [showSettingsChips, setShowSettingsChips] = useState(true);

  // Add state for saved configs
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingConfig, setIsTestingConfig] = useState(false);

  // Add new state for keyboard mode
  const [isKeyboardMode, setIsKeyboardMode] = useState(false);
  const [textInput, setTextInput] = useState<string>('');

  // Add new state for voice mode
  const [isVoiceMode, setIsVoiceMode] = useState(false);

  // Add new state for input mode
  const [inputMode, setInputMode] = useState<InputMode>('text');

  // Add new state for personality selector
  const [showPersonalitySelector, setShowPersonalitySelector] = useState(false);

  // Add click outside handler for personality selector
  const personalitySelectorRef = useRef<HTMLDivElement>(null);

  // Add new state for tool configs
  const [toolConfigs, setToolConfigs] = useState<Record<string, any>>({});

  // Memoize state setters to prevent unnecessary re-renders
  const memoizedSetters = useMemo(() => ({
    setConversations,
    setSettings,
    setSavedConfigs,
    setToolConfigs,
    setStatus,
    setAudioState
  }), []);

  // Add toast state
  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'info' | 'success';
    visible: boolean;
  }>({
    message: '',
    type: 'info',
    visible: false
  });

  // Toast helper function
  const showToast = (message: string, type: 'error' | 'info' | 'success' = 'info') => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
  };

  // Add helper functions at component level
  const getChipColor = (key: string) => {
    switch (key) {
      case 'llm_api_endpoint':
        return 'from-blue-500 to-blue-600';
      case 'llm_model':
        return 'from-purple-500 to-purple-600';
      case 'llm_temperature':
        return 'from-green-500 to-green-600';
      case 'llm_max_tokens':
        return 'from-yellow-500 to-yellow-600';
      case 'elevenlabs_api_key':
        return 'from-red-500 to-red-600';
      case 'elevenlabs_voice_id':
        return 'from-orange-500 to-orange-600';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  const getReadableName = (key: string) => {
    const names: Record<string, string> = {
      llm_api_endpoint: 'API Endpoint',
      llm_model: 'Model',
      llm_temperature: 'Temperature',
      llm_max_tokens: 'Max Tokens',
      elevenlabs_api_key: 'ElevenLabs Key',
      elevenlabs_voice_id: 'Voice ID'
    };
    return names[key] || key;
  };

  const getDisplayValue = (key: string, value: string) => {
    if (key === 'elevenlabs_api_key' && value) {
      return value.slice(0, 4) + '...' + value.slice(-4);
    }
    return value;
  };

  const handleUpdateSetting = async (key: string, value: string) => {
    let parsedValue: string | number = value;
    
    // Parse numeric values
    if (key === 'llm_temperature') {
      parsedValue = parseFloat(value) || 0.7;
    } else if (key === 'llm_max_tokens') {
      parsedValue = parseInt(value) || 1000;
    }

    setSettings(prev => ({
      ...prev,
      [key]: parsedValue
    }));
  };

  const handleRemoveSetting = async (key: string) => {
    setSettings(prev => ({
      ...prev,
      [key]: null
    }));
  };

  const playAudioResponse = async (audioData: Uint8Array) => {
    try {
      // Create a Blob from the audio data with correct MIME type
      const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
      // Generate a URL for the Blob
      const audioUrl = URL.createObjectURL(audioBlob);
      // Create an audio element
      const audioElement = new Audio(audioUrl);
  
      // Wait for the audio to be ready to play
      await new Promise((resolve) => {
        audioElement.addEventListener('canplaythrough', resolve, { once: true });
      });
  
      // Play the audio
      await audioElement.play();
  
      // Wait for playback to finish and clean up the URL
      await new Promise((resolve) => {
        audioElement.addEventListener('ended', resolve, { once: true });
      });
  
      URL.revokeObjectURL(audioUrl);
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };

  const streamText = useCallback((fullText: string, messageId: number) => {
    let index = 0;
    const interval = setInterval(() => {
      if (index <= fullText.length) {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === messageId ? { 
              ...msg, 
              text: fullText.slice(0, index),
              isStreaming: index < fullText.length
            } : msg
          )
        );
        index++;
      } else {
        clearInterval(interval);
        setStatus('');
      }
    }, 30); // Faster typing speed

    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, []);

  // WebSocket message handler
  const handleWebSocketMessage = useCallback(async (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received WebSocket message:', data);
      
      switch (data.type) {
        case 'tool_config_updated':
          console.log('Tool config updated:', data);
          setToolConfigs(prev => ({
            ...prev,
            [data.tool]: {
              ...prev[data.tool],
              ...data.config
            }
          }));
          // Update elevenlabs_enabled setting if it's an ElevenLabs update
          if (data.tool === 'elevenlabs_tts') {
            const newValue = data.config.is_enabled ? 'true' : 'false';
            setSettings(prev => ({
              ...prev,
              elevenlabs_enabled: newValue
            }));
          }
          break;
        case 'tts_response':
          if (data.audio && settings.elevenlabs_enabled === 'true') {
            console.log('Playing TTS response...');
            const audioData = new Uint8Array(data.audio);
            playAudioResponse(audioData);
          } else {
            console.log('ElevenLabs is disabled, skipping TTS');
          }
          break;
        case 'transcription':
          setMessages(prev => [...prev, { id: Date.now(), text: data.text, isAI: false, isStreaming: false }]);
          break;
        case 'ai_response':
          const messageId = Date.now();
          setMessages(prev => [...prev, { id: messageId, text: '', isAI: true, isStreaming: true }]);
          streamText(data.text, messageId);
          break;
        case 'error':
          console.error('WebSocket error:', data.error);
          setStatus(`Error: ${data.error}`);
          break;
        case 'status':
          setStatus(data.status);
          break;
        case 'connection_established':
          setAudioState(prev => ({ ...prev, wsConnected: true }));
          break;
        case 'new_conversation':
          setCurrentConversation(data.conversation.id);
          setConversations(prev => [data.conversation, ...prev]);
          break;
        case 'personalities':
          setPersonalities(data.personalities);
          const defaultPersonality = data.personalities.find((p: Personality) => p.is_default);
          setCurrentPersonality(defaultPersonality || null);
          break;
        case 'personality_default_set':
          setPersonalities(prev => prev.map(p => ({
            ...p,
            is_default: p.id === data.personality.id
          })));
          setCurrentPersonality(data.personality);
          break;
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  }, [streamText, toolConfigs, playAudioResponse, handleUpdateSetting, settings]);

  // Define cleanupWebSocket first
  const cleanupWebSocket = useCallback(() => {
    console.log('Cleaning up WebSocket connection...');
    
    if (wsReconnectTimeout.current) {
      console.log('Clearing reconnection timeout');
      clearTimeout(wsReconnectTimeout.current);
      wsReconnectTimeout.current = undefined;
    }

    if (wsRef.current) {
      console.log('Closing existing WebSocket connection');
      wsRef.current.onclose = null; // Remove onclose handler first
      wsRef.current.onerror = null; // Remove error handler
      wsRef.current.onmessage = null; // Remove message handler
      wsRef.current.onopen = null; // Remove open handler
      
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'Intentional cleanup');
      }
      wsRef.current = null;
    }

    connectionAttempts.current = 0;
  }, []);

  // Update the WebSocket connection setup with proper dependencies
  const connectWebSocket = useCallback(() => {
    // Clean up any existing connection first
    cleanupWebSocket();

    console.log('Establishing new WebSocket connection...');
    const wsUrl = 'ws://localhost:3001/ws';
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('WebSocket connected successfully');
      connectionAttempts.current = 0;
      memoizedSetters.setAudioState(prev => ({ ...prev, wsConnected: true, error: null }));
      
      // Request personalities only after successful connection
      wsRef.current?.send(JSON.stringify({ type: 'get_personalities' }));
    };

    wsRef.current.onclose = (event) => {
      console.log('WebSocket closed with code:', event.code, 'reason:', event.reason);
      memoizedSetters.setAudioState(prev => ({ ...prev, wsConnected: false, isListening: false }));
      
      if (event.code !== 1000 && 
          event.code !== 1001 && 
          connectionAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        connectionAttempts.current += 1;
        const backoffTime = Math.min(1000 * Math.pow(2, connectionAttempts.current), 10000);
        console.log(`Scheduling reconnection attempt ${connectionAttempts.current}/${MAX_RECONNECT_ATTEMPTS} in ${backoffTime}ms`);
        wsReconnectTimeout.current = setTimeout(connectWebSocket, backoffTime);
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error occurred:', error);
      memoizedSetters.setAudioState(prev => ({ 
        ...prev, 
        error: 'Connection error. Please check if the server is running.',
        wsConnected: false 
      }));
    };

    wsRef.current.onmessage = handleWebSocketMessage;
  }, [handleWebSocketMessage, memoizedSetters, cleanupWebSocket]);

  // Load initial data
  useEffect(() => {
    let mounted = true;

    const loadInitialData = async () => {
      try {
        console.log('Loading initial data...');
        const [conversationsRes, settingsRes, configsRes, toolConfigsRes] = await Promise.all([
          fetch('http://localhost:3001/conversations'),
          fetch('http://localhost:3001/settings'),
          fetch('http://localhost:3001/saved-configs'),
          fetch('/api/tool-configs')
        ]);

        if (!mounted) return;

        if (!conversationsRes.ok) throw new Error('Failed to fetch conversations');
        if (!settingsRes.ok) throw new Error('Failed to fetch settings');
        if (!configsRes.ok) throw new Error('Failed to fetch saved configs');
        if (!toolConfigsRes.ok) throw new Error('Failed to fetch tool configs');

        const [conversations, settings, configs, toolConfigs] = await Promise.all([
          conversationsRes.json(),
          settingsRes.json(),
          configsRes.json(),
          toolConfigsRes.json()
        ]);

        if (!mounted) return;

        console.log('Setting initial data...');
        console.log('Tool configs:', toolConfigs);
        setConversations(conversations);
        setSettings(settings);
        setSavedConfigs(configs);
        setToolConfigs(toolConfigs);

        // Only after loading initial data, establish WebSocket connection
        console.log('Initial data loaded, connecting WebSocket...');
        connectWebSocket();
      } catch (error) {
        console.error('Error loading initial data:', error);
        if (mounted) {
          setStatus('Error loading initial data. Please refresh the page.');
        }
      }
    };

    loadInitialData();

    return () => {
      mounted = false;
    };
  }, []);

  const isError = (error: unknown): error is Error => {
    return error instanceof Error;
  };

  const initializeAudio = async () => {
    try {
      if (!audioContext.current) {
        audioContext.current = new AudioContext({
          sampleRate: 16000  // Match Whisper's expected sample rate
        });
      }
      
      // Resume AudioContext if it's suspended (browser requires user gesture)
      if (audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
      }

      // Load audio worklet
      await audioContext.current.audioWorklet.addModule('/audioProcessor.js');
      
      // Get microphone access
      audioStream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // Create audio processor
      audioProcessor.current = new AudioWorkletNode(audioContext.current, 'audio-processor');
      
      // Set up message handling
      audioProcessor.current.port.onmessage = (event) => {
        if (event.data.type === 'audioData' && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data.buffer);
        }
      };

      setAudioState(prev => ({ ...prev, isInitialized: true }));
      console.log('Initialized with sample rate:', audioContext.current.sampleRate);
      
      return true;
    } catch (error) {
      console.error('Error initializing audio:', error);
      const errorMessage = isError(error) ? error.message : 'Unknown error occurred';
      setAudioState(prev => ({ 
        ...prev, 
        error: 'Failed to initialize audio: ' + errorMessage,
        isInitialized: false 
      }));
      return false;
    }
  };

  const startRecording = async () => {
    try {
      // Initialize audio on first user interaction
      if (!audioProcessor.current) {
        const initialized = await initializeAudio();
        if (!initialized) return;
      }

      // Connect audio nodes
      if (audioStream.current && audioProcessor.current && audioContext.current) {
        const source = audioContext.current.createMediaStreamSource(audioStream.current);
        source.connect(audioProcessor.current);
        audioProcessor.current.connect(audioContext.current.destination);
        
        // Start recording
        audioProcessor.current.port.postMessage({ command: 'start' });
        setAudioState(prev => ({ ...prev, isListening: true }));
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      const errorMessage = isError(error) ? error.message : 'Unknown error occurred';
      setAudioState(prev => ({ 
        ...prev, 
        error: 'Failed to start recording: ' + errorMessage,
        isListening: false 
      }));
    }
  };

  const stopRecording = async () => {
    try {
      if (audioProcessor.current) {
        // Stop recording
        audioProcessor.current.port.postMessage({ command: 'stop' });
        
        // Disconnect nodes
        audioProcessor.current.disconnect();
        
        setAudioState(prev => ({ ...prev, isListening: false }));
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      const errorMessage = isError(error) ? error.message : 'Unknown error occurred';
      setAudioState(prev => ({ 
        ...prev, 
        error: 'Failed to stop recording: ' + errorMessage,
        isListening: false 
      }));
    }
  };

  // Load conversations
  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const response = await fetch('http://localhost:3001/conversations');
        const data = await response.json();
        // Handle the conversations data
        console.log('Conversations:', data);
        setConversations(data);
      } catch (error) {
        console.error('Error fetching conversations:', error);
      }
    };

    fetchConversations();
  }, []);

  // Load conversation messages when selecting a conversation
  useEffect(() => {
    const loadMessages = async () => {
      if (!currentConversation) return;

      try {
        const response = await fetch(`http://localhost:3001/conversations/${currentConversation}/messages`);
        if (!response.ok) {
          if (response.status === 404) {
            setStatus('Conversation not found.');
            setCurrentConversation(null);
            return;
          }
          throw new Error(`Failed to fetch messages: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Check if data is an array, if not, use messages property or empty array
        const messagesArray = Array.isArray(data) ? data : (data.messages || []);
        
        setMessages(messagesArray.map((msg: any) => ({
          id: msg.id || Date.now(),
          text: msg.text || '',
          isAI: msg.is_ai || false,
          isStreaming: false
        })));
      } catch (error) {
        console.error('Error loading messages:', error);
        setStatus('Error loading messages. Please try again.');
      }
    };

    loadMessages();
  }, [currentConversation]);

  // Initialize audio context
  useEffect(() => {
    const initAudio = async () => {
      try {
        audioContext.current = new AudioContext();
        await audioContext.current.audioWorklet.addModule('/audioProcessor.js');
        setAudioState(prev => ({ ...prev, isInitialized: true }));
        console.log('Initialized with sample rate:', audioContext.current.sampleRate);
      } catch (err) {
        console.error('Failed to initialize audio:', err);
        setAudioState(prev => ({ 
          ...prev, 
          error: 'Failed to initialize audio system',
          isInitialized: false 
        }));
      }
    };

    initAudio();
    return () => {
      if (audioContext.current?.state !== 'closed') {
        audioContext.current?.close();
      }
    };
  }, []);

  // Load settings on component mount
  useEffect(() => {
    const loadSettings = async () => {
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelay = 2000; // 2 seconds

      const tryLoadSettings = async () => {
        try {
          const response = await fetch('http://localhost:3001/settings');
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          setSettings(data);

          // Check if required settings are missing
          if (!data.llm_api_endpoint || !data.llm_model) {
            setIsSettingsPanelOpen(true);
            setStatus('Please configure required LLM settings to continue');
          }
        } catch (error) {
          console.error('Failed to load settings:', error);
          if (retryCount < maxRetries) {
            retryCount++;
            setStatus(`Retrying to connect to server... (${retryCount}/${maxRetries})`);
            setTimeout(tryLoadSettings, retryDelay);
          } else {
            setIsSettingsPanelOpen(true);
            setStatus('Failed to connect to server. Please check if the server is running.');
          }
        }
      };

      await tryLoadSettings();
    };

    loadSettings();
  }, []);

  // Load saved configs on mount
  useEffect(() => {
    const loadSavedConfigs = async () => {
      try {
        const response = await fetch('http://localhost:3001/saved-configs');
        if (!response.ok) throw new Error('Failed to load saved configs');
        const configs = await response.json();
        setSavedConfigs(configs);
      } catch (error) {
        console.error('Error loading saved configs:', error);
      }
    };

    loadSavedConfigs();
  }, []);

  // Load settings from localStorage on mount
  useEffect(() => {
    const loadSettings = () => {
      const savedSettings = localStorage.getItem('settings');
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings);
          setSettings(parsed);
        } catch (error) {
          console.error('Error parsing saved settings:', error);
        }
      }
    };

    loadSettings();
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem('settings', JSON.stringify(settings));
  }, [settings]);

  // Function to fetch available models
  const fetchModels = async (endpoint: string) => {
    setIsLoadingModels(true);
    try {
      const response = await fetch(`${endpoint}/v1/models`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setAvailableModels(data.data || []);
      return data.data || [];
    } catch (error) {
      console.error('Failed to fetch models:', error);
      setStatus('Failed to fetch available models');
      return [];
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Check if settings are properly configured
  const areSettingsConfigured = useCallback(() => {
    return !!(settings.llm_api_endpoint && settings.llm_model);
  }, [settings.llm_api_endpoint, settings.llm_model]);

  const testMicrophoneRecording = async () => {
    try {
      setDebugState(prev => ({ ...prev, debugStatus: 'Testing microphone recording...' }));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/wav' });
        const arrayBuffer = await blob.arrayBuffer();
        const audioData = new Uint8Array(arrayBuffer);
        setDebugState(prev => ({ 
          ...prev, 
          recordedAudio: audioData,
          debugStatus: 'Recording test complete'
        }));
        await playAudioResponse(audioData);
      };

      recorder.start();
      setTimeout(() => {
        recorder.stop();
        stream.getTracks().forEach(track => track.stop());
      }, 3000);
    } catch (error) {
      console.error('Microphone test failed:', error);
      setDebugState(prev => ({ ...prev, debugStatus: 'Microphone test failed' }));
    }
  };

  const testTranscription = async () => {
    if (!audioContext.current) {
      setDebugState(prev => ({ ...prev, debugStatus: 'Audio system not initialized' }));
      return;
    }

    if (debugState.isRecordingTest) {
      // Stop recording
      try {
        setDebugState(prev => ({ ...prev, isRecordingTest: false, debugStatus: 'Processing recording...' }));
        
        if (debugAudioProcessor.current) {
          debugAudioProcessor.current.port.postMessage({ command: 'stop' });
          debugAudioProcessor.current.disconnect();
          debugAudioProcessor.current = null;
        }

        if (debugAudioStream.current) {
          debugAudioStream.current.getTracks().forEach(track => track.stop());
          debugAudioStream.current = null;
        }

      } catch (error) {
        console.error('Error stopping test recording:', error);
        const errorMessage = isError(error) ? error.message : 'Unknown error occurred';
        setDebugState(prev => ({ 
          ...prev, 
          debugStatus: 'Failed to stop recording: ' + errorMessage 
        }));
      }
    } else {
      // Start recording
      try {
        const ctx = audioContext.current;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // Get microphone access
        debugAudioStream.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });

        // Create and connect nodes
        const source = ctx.createMediaStreamSource(debugAudioStream.current);
        debugAudioProcessor.current = new AudioWorkletNode(ctx, 'audio-processor');

        // Send the actual sample rate to the audio processor
        debugAudioProcessor.current.port.postMessage({ 
          command: 'setSampleRate', 
          sampleRate: ctx.sampleRate 
        });

        // Set up message handling
        debugAudioProcessor.current.port.onmessage = (event) => {
          if (event.data.type === 'audioData' && wsRef.current?.readyState === WebSocket.OPEN) {
            // Send complete audio data as debug message
            wsRef.current.send(JSON.stringify({
              type: 'debug',
              action: 'transcribe',
              audio: Array.from(new Float32Array(event.data.buffer))
            }));
            
            setDebugState(prev => ({ 
              ...prev,
              debugStatus: 'Processing recording...'
            }));
          }
        };

        // Connect nodes
        source.connect(debugAudioProcessor.current);
        
        // Start recording
        debugAudioProcessor.current.port.postMessage({ command: 'start' });

        setDebugState(prev => ({ 
          ...prev, 
          isRecordingTest: true, 
          debugStatus: 'Recording test audio... Click again to stop.',
          lastTranscription: null
        }));

      } catch (error) {
        console.error('Error starting test recording:', error);
        const errorMessage = isError(error) ? error.message : 'Unknown error occurred';
        setDebugState(prev => ({ 
          ...prev, 
          debugStatus: 'Failed to start recording: ' + errorMessage 
        }));
      }
    }
  };

  const testLLMConnection = async () => {
    try {
      setDebugState(prev => ({ ...prev, debugStatus: 'Testing LLM connection...' }));
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'debug',
          action: 'llm',
          text: "Hello! Please respond with a short test message to verify you're working correctly."
        }));
      }
    } catch (error) {
      console.error('LLM test failed:', error);
      setDebugState(prev => ({ ...prev, debugStatus: 'LLM test failed' }));
    }
  };

  const testTTSConnection = async () => {
    try {
      setDebugState(prev => ({ ...prev, debugStatus: 'Testing TTS connection...' }));
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'debug',
          action: 'tts',
          text: "This is a test of the text to speech system."
        }));
      }
    } catch (error) {
      console.error('TTS test failed:', error);
      setDebugState(prev => ({ ...prev, debugStatus: 'TTS test failed' }));
    }
  };

  const handleSaveConfig = async (name: string) => {
    if (!name) {
      console.error('Please enter a name for this configuration');
      return;
    }

    setIsSavingConfig(true);
    setIsTestingConfig(true);

    try {
      // Test the connection first
      const response = await fetch(settings.llm_api_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.llm_model,
          messages: [{ role: 'user', content: 'Test' }],
          temperature: settings.llm_temperature || 0.7,
          max_tokens: settings.llm_max_tokens || 1000
        }),
      });

      if (!response.ok) {
        console.error('Failed to test connection to LLM');
        setIsSavingConfig(false);
        setIsTestingConfig(false);
        return;
      }

      setIsTestingConfig(false);

      // Save the config
      const saveResponse = await fetch('http://localhost:3001/saved-configs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          endpoint: settings.llm_api_endpoint,
          model: settings.llm_model,
          temperature: settings.llm_temperature?.toString() || '0.7',
          max_tokens: settings.llm_max_tokens?.toString() || '1000',
          elevenlabs_api_key: settings.elevenlabs_api_key || null,
          elevenlabs_voice_id: settings.elevenlabs_voice_id || null
        }),
      });

      if (!saveResponse.ok) {
        throw new Error(`HTTP error! status: ${saveResponse.status}`);
      }

      const savedConfig = await saveResponse.json();
      setSavedConfigs(prev => [savedConfig, ...prev]);
    } catch (error) {
      console.error('Error saving configuration:', error);
    } finally {
      setIsSavingConfig(false);
      setIsTestingConfig(false);
    }
  };

  const handleDeleteConfig = async (id: number) => {
    try {
      const response = await fetch(`http://localhost:3001/saved-configs/${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete configuration');
      }

      setSavedConfigs(prev => prev.filter(config => config.id !== id));
    } catch (error) {
      console.error('Error deleting configuration:', error);
    }
  };

  const handleUpdateConfig = async (id: number, updatedConfig: Partial<SavedConfig>) => {
    try {
      const response = await fetch(`http://localhost:3001/saved-configs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedConfig)
      });

      if (!response.ok) {
        throw new Error('Failed to update configuration');
      }

      const updated = await response.json();
      setSavedConfigs(prev => prev.map(config => 
        config.id === id ? { ...config, ...updated } : config
      ));
    } catch (error) {
      console.error('Error updating configuration:', error);
    }
  };

  // Add handler for setting default config
  const handleSetDefaultConfig = async (id: number) => {
    try {
      const response = await fetch(`http://localhost:3001/saved-configs/${id}/set-default`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to set default configuration');
      }

      const updatedConfig = await response.json();
      setSavedConfigs(prev => prev.map(config => ({
        ...config,
        is_default: config.id === id
      })));
    } catch (error) {
      console.error('Error setting default config:', error);
    }
  };

  const handleSendMessage = () => {
    if (textInput.trim()) {
      const messageId = Date.now();
      setMessages(prev => [...prev, {
        id: messageId,
        text: textInput.trim(),
        isAI: false,
        isStreaming: false
      }]);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'message',
          role: 'user',
          content: textInput.trim()
        }));
      } else {
        setStatus('Connection error. Please try again.');
      }

      setTextInput('');
    }
  };

  const handleTextSubmit = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Add click outside handler for personality selector
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (personalitySelectorRef.current && !personalitySelectorRef.current.contains(event.target as Node)) {
        setShowPersonalitySelector(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Add tool-related functions
  const handleUpdateToolConfig = async (toolName: string, configKey: string, configValue: string) => {
    try {
      const response = await fetch(`/api/tool-configs/${toolName}/${configKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ value: configValue })
      });

      if (!response.ok) {
        throw new Error('Failed to update tool config');
      }

      setToolConfigs(prev => ({
        ...prev,
        [toolName]: {
          ...prev[toolName],
          [configKey]: configValue
        }
      }));

      // Send updated tool config to WebSocket server
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'update_tool_config',
          tool: toolName,
          config: {
            [configKey]: configValue
          }
        }));
      }
    } catch (error) {
      console.error('Error updating tool config:', error);
    }
  };

  const handleSetToolEnabled = async (toolName: string, isEnabled: boolean) => {
    try {
      console.log(`Setting ${toolName} enabled state to:`, isEnabled);
      
      const response = await fetch(`/api/tool-configs/${toolName}/enabled`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: isEnabled })
      });

      if (!response.ok) {
        throw new Error(`Failed to update ${toolName} enabled state: ${response.statusText}`);
      }

      const updatedConfig = await response.json();
      console.log(`Updated ${toolName} config:`, updatedConfig);

      setToolConfigs(prev => ({
        ...prev,
        [toolName]: {
          ...prev[toolName],
          is_enabled: isEnabled
        }
      }));

      // Notify WebSocket of the change
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'update_tool_config',
          tool: toolName,
          config: {
            is_enabled: isEnabled
          }
        }));
      }
    } catch (error) {
      console.error(`Error updating ${toolName} enabled state:`, error);
      // Revert the toggle if the update failed
      setToolConfigs(prev => ({
        ...prev,
        [toolName]: {
          ...prev[toolName]
        }
      }));
    }
  };

  // Voice toggle handler with validation
  const handleVoiceToggle = async () => {
    // Check for required settings
    if (!settings.elevenlabs_api_key || !settings.elevenlabs_voice_id) {
      showToast('Please configure ElevenLabs API key and Voice ID in settings first', 'error');
      return;
    }

    const newValue = settings.elevenlabs_enabled === 'true' ? 'false' : 'true';
    await handleUpdateSetting('elevenlabs_enabled', newValue);
    // Also update the tool config to keep them in sync
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'update_tool_config',
        tool: 'elevenlabs_tts',
        config: {
          is_enabled: newValue === 'true'
        }
      }));
    }
  };

  return (
    <div className="h-screen w-full bg-[#0A0A0A] flex flex-col overflow-hidden">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast.visible && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg ${
              toast.type === 'error' ? 'bg-red-500' :
              toast.type === 'success' ? 'bg-green-500' :
              'bg-blue-500'
            }`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 rounded-xl hover:bg-white/5 transition-colors"
          >
            <Menu className="w-5 h-5 text-white/70" />
          </button>
          <div className="flex items-center space-x-2">
            {/* Input Mode Toggle */}
            <button
              onClick={() => setInputMode(prev => prev === 'text' ? 'push-to-talk' : 'text')}
              className="p-2 rounded-xl hover:bg-white/5 transition-colors"
            >
              {inputMode === 'text' ? (
                <Keyboard className="w-5 h-5 text-white/70" />
              ) : (
                <Mic className="w-5 h-5 text-white/70" />
              )}
            </button>
            {/* Personality Selector */}
            <div className="relative" ref={personalitySelectorRef}>
              <button
                onClick={() => setShowPersonalitySelector(prev => !prev)}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
              >
                <Brain className="w-4 h-4 text-white/70" />
                <span className="text-sm text-white/90">
                  {currentPersonality?.name || 'Select Personality'}
                </span>
                {currentPersonality?.is_builtin && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                    Built-in
                  </span>
                )}
              </button>
              {/* Personality Dropdown */}
              <AnimatePresence>
                {showPersonalitySelector && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full left-0 mt-2 w-64 bg-[#1A1A1A] border border-white/10 rounded-lg shadow-xl z-50"
                  >
                    <div className="p-2 space-y-1">
                      {personalities.map((personality) => (
                        <button
                          key={personality.id}
                          onClick={() => {
                            if (wsRef.current?.readyState === WebSocket.OPEN) {
                              wsRef.current.send(JSON.stringify({
                                type: 'set_default_personality',
                                id: personality.id
                              }));
                            }
                            setShowPersonalitySelector(false);
                          }}
                          className="flex items-center justify-between w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center space-x-2">
                            <span className="text-sm text-white/90">{personality.name}</span>
                            {personality.is_builtin && (
                              <span className="px-1.5 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                                Built-in
                              </span>
                            )}
                          </div>
                          {personality.is_default && (
                            <div className="text-green-500">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleVoiceToggle}
            className={`p-2 rounded-xl hover:bg-white/5 transition-colors ${
              !settings.elevenlabs_api_key || !settings.elevenlabs_voice_id
                ? 'text-white/30 cursor-not-allowed'
                : settings.elevenlabs_enabled === 'true'
                  ? 'text-blue-400'
                  : 'text-white/30'
            }`}
            title={!settings.elevenlabs_api_key || !settings.elevenlabs_voice_id
              ? 'Configure ElevenLabs API key and Voice ID in settings first'
              : `Voice is ${settings.elevenlabs_enabled === 'true' ? 'enabled' : 'disabled'}`}
          >
            <Volume2 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsSettingsPanelOpen(true)}
            className="p-2 rounded-xl hover:bg-white/5 transition-colors"
          >
            <Settings2 className="w-5 h-5 text-white/70" />
          </button>
          <button
            onClick={() => setIsDebugPanelOpen(true)}
            className="p-2 rounded-xl hover:bg-white/5 transition-colors"
          >
            <Bug className="w-5 h-5 text-white/70" />
          </button>
        </div>
      </div>

      {/* Messages Container - Scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-6 py-4 space-y-4">
          <AnimatePresence mode="popLayout">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`flex ${message.isAI ? 'justify-start' : 'justify-end'}`}
              >
                <div className={`max-w-[70%] p-4 rounded-2xl shadow-lg ${
                  message.isAI 
                    ? 'bg-[#1E1E1E] text-white rounded-bl-none'
                    : 'bg-blue-600 text-white rounded-br-none'
                }`}>
                  <div className="text-base whitespace-pre-wrap">
                    {message.text}
                    {message.isAI && !message.text && (
                      <div className="flex items-center space-x-1">
                        <motion.div
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1] }}
                          className="w-1.5 h-1.5 bg-white/50 rounded-full"
                        />
                        <motion.div
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1], delay: 0.2 }}
                          className="w-1.5 h-1.5 bg-white/50 rounded-full"
                        />
                        <motion.div
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1], delay: 0.4 }}
                          className="w-1.5 h-1.5 bg-white/50 rounded-full"
                        />
                      </div>
                    )}
                    {message.isStreaming && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="inline-block w-2 h-4 ml-1 bg-blue-400/50"
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom Section - Fixed */}
      <div className="w-full flex-none">
        {/* Status Bar */}
        <div className="bg-[#1A1A1A] border-t border-white/5">
          <div className="px-6 py-2">
            <div className="max-w-screen-sm mx-auto">
              <AnimatePresence mode="wait">
                {(audioState.error || (!audioState.wsConnected && !audioState.error)) && (
                  <motion.div 
                    key="connection-status"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`text-sm font-medium text-center ${
                      audioState.error ? 'text-red-400' :
                      !audioState.wsConnected ? 'text-yellow-400' :
                      'text-blue-400'
                    }`}
                  >
                    {audioState.error ? audioState.error :
                     !audioState.wsConnected ? 'Connecting to server...' : ''}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="bg-[#1A1A1A] border-t border-white/5">
          <div className="max-w-screen-sm mx-auto px-6 py-4 relative">
            <AnimatePresence mode="wait">
              {inputMode === 'text' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-end"
                >
                  <div className="flex-1 relative">
                    <textarea
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={handleTextSubmit}
                      placeholder="Type your message here... (Press Enter to send, Shift + Enter for new line)"
                      className="w-full p-4 pr-12 bg-[#2A2A2A] text-white rounded-xl border border-white/10 focus:border-white/20 focus:ring-1 focus:ring-white/20 outline-none resize-none"
                      rows={2}
                    />
                    <button
                      onClick={handleSendMessage}
                      className="absolute right-3 bottom-3 p-2 rounded-lg text-white/70 hover:text-white/90 transition-colors"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </motion.div>
              )}

              {inputMode === 'push-to-talk' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-center"
                >
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={audioState.isListening ? stopRecording : startRecording}
                    disabled={!audioState.isInitialized || processingRef.current || !audioState.wsConnected || !areSettingsConfigured()}
                    className={`p-6 rounded-2xl transition-all duration-300 shadow-lg ${
                      !audioState.isInitialized || !audioState.wsConnected || !areSettingsConfigured()
                        ? 'bg-neutral-800 text-neutral-600'
                        : audioState.isListening
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    <motion.div
                      animate={{ scale: audioState.isListening ? [1, 1.2, 1] : 1 }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      {audioState.isListening ? (
                        <MicOff className="w-8 h-8 text-white" />
                      ) : (
                        <Mic className="w-8 h-8 text-white" />
                      )}
                    </motion.div>
                  </motion.button>
                </motion.div>
              )}

              {inputMode === 'trigger-word' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-center"
                >
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={audioState.isListening ? stopRecording : startRecording}
                    disabled={!audioState.isInitialized || processingRef.current || !audioState.wsConnected || !areSettingsConfigured()}
                    className={`p-6 rounded-2xl transition-all duration-300 shadow-lg ${
                      !audioState.isInitialized || !audioState.wsConnected || !areSettingsConfigured()
                        ? 'bg-neutral-800 text-neutral-600'
                        : audioState.isListening
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    <motion.div
                      animate={{ scale: audioState.isListening ? [1, 1.2, 1] : 1 }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      <Ear className="w-8 h-8 text-white" />
                    </motion.div>
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Input Mode Toggles */}
          <div className="absolute bottom-4 right-6 flex flex-col space-y-2">
            {inputMode !== 'push-to-talk' && (
              <button
                onClick={() => setInputMode('push-to-talk')}
                className="p-3 rounded-xl bg-neutral-800 text-neutral-600 hover:text-neutral-400 transition-all duration-300 shadow-lg"
              >
                <Mic className="w-5 h-5" />
              </button>
            )}
            {inputMode !== 'trigger-word' && (
              <button
                onClick={() => setInputMode('trigger-word')}
                className="p-3 rounded-xl bg-neutral-800 text-neutral-600 hover:text-neutral-400 transition-all duration-300 shadow-lg"
              >
                <Ear className="w-5 h-5" />
              </button>
            )}
            {inputMode !== 'text' && (
              <button
                onClick={() => setInputMode('text')}
                className="p-3 rounded-xl bg-neutral-800 text-neutral-600 hover:text-neutral-400 transition-all duration-300 shadow-lg"
              >
                <Keyboard className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Panels */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <ConversationHistory
            key="conversation-history"
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            conversations={conversations}
            currentConversation={currentConversation}
            onSelectConversation={setCurrentConversation}
          />
        )}

        {isDebugPanelOpen && (
          <DebugPanel
            key="debug-panel"
            isOpen={isDebugPanelOpen}
            onClose={() => setIsDebugPanelOpen(false)}
            debugState={debugState}
            setDebugState={setDebugState}
            audioState={audioState}
            testMicrophoneRecording={testMicrophoneRecording}
            testTranscription={testTranscription}
            testLLMConnection={testLLMConnection}
            testTTSConnection={testTTSConnection}
            connectWebSocket={connectWebSocket}
            playAudioResponse={playAudioResponse}
          />
        )}

        {isSettingsPanelOpen && (
          <SettingsPanel
            key="settings-panel"
            isOpen={isSettingsPanelOpen}
            onClose={() => setIsSettingsPanelOpen(false)}
            settings={settings}
            onUpdateSetting={handleUpdateSetting}
            onRemoveSetting={handleRemoveSetting}
            savedConfigs={savedConfigs}
            onSaveConfig={handleSaveConfig}
            onDeleteConfig={handleDeleteConfig}
            onUpdateConfig={handleUpdateConfig}
            onSetDefaultConfig={handleSetDefaultConfig}
            isSavingConfig={isSavingConfig}
            isTestingConfig={isTestingConfig}
            availableModels={availableModels}
            isLoadingModels={isLoadingModels}
            onFetchModels={fetchModels}
            toolConfigs={toolConfigs}
            onUpdateToolConfig={handleUpdateToolConfig}
            onSetToolEnabled={handleSetToolEnabled}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default VoiceAssistant;
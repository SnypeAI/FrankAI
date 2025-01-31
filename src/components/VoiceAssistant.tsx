'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Menu, X, MessageSquare, Bug, Play, RefreshCw, Wand2, Volume2, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

interface ChatMessage {
  id: number;
  text: string;
  isAI: boolean;
  isStreaming: boolean;
}

interface Conversation {
  id: number;
  title: string;
  updatedAt: string;
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

const VoiceAssistant: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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

  // Move connectWebSocket declaration before its usage
  const connectWebSocket = useCallback(function initWebSocket() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (connectionAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      setAudioState(prev => ({
        ...prev,
        error: 'Maximum reconnection attempts reached. Please reload the page.',
        wsConnected: false
      }));
      return;
    }

    try {
      wsRef.current = new WebSocket('ws://localhost:8000/ws');
      connectionAttempts.current++;
      
      wsRef.current.onopen = () => {
        console.log('WebSocket connected successfully');
        connectionAttempts.current = 0;
        setAudioState(prev => ({ 
          ...prev, 
          wsConnected: true, 
          error: null 
        }));
      };

      wsRef.current.onclose = (event) => {
        const reason = event.reason ? `: ${event.reason}` : '';
        console.log(`WebSocket closed with code: ${event.code}${reason}`);
        setAudioState(prev => ({ 
          ...prev, 
          wsConnected: false,
          isListening: false,
          error: event.reason ? `Connection closed: ${event.reason}` : 'Connection closed'
        }));

        if (connectionAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          console.log(`Attempting to reconnect (${connectionAttempts.current + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
          wsReconnectTimeout.current = setTimeout(initWebSocket, 2000);
        }
      };

      wsRef.current.onmessage = async (event) => {
        if (event.data instanceof Blob) {
          try {
            const buffer = await event.data.arrayBuffer();
            const audioData = new Uint8Array(buffer);
            if (isDebugPanelOpen) {
              setDebugState(prev => ({ 
                ...prev, 
                lastTTSAudio: audioData,
                debugStatus: 'Audio response received'
              }));
            }
            await playAudioResponse(audioData);
          } catch (error) {
            console.error('Error playing audio response:', error);
            if (!isDebugPanelOpen) {
              setStatus('Failed to play audio response');
            }
          }
        } else if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            
            // Handle debug-specific messages
            if (data.type === 'debug') {
              switch (data.action) {
                case 'transcription':
                  setDebugState(prev => ({
                    ...prev,
                    lastTranscription: data.text,
                    debugStatus: 'Transcription complete: ' + data.text
                  }));
                  break;
                case 'llm':
                  setDebugState(prev => ({
                    ...prev,
                    lastLLMResponse: data.text,
                    debugStatus: 'LLM response received'
                  }));
                  break;
                case 'tts':
                  setDebugState(prev => ({
                    ...prev,
                    debugStatus: 'TTS response received'
                  }));
                  break;
                case 'error':
                  setDebugState(prev => ({
                    ...prev,
                    debugStatus: `Error: ${data.message}`
                  }));
                  break;
              }
              return;
            }

            // Handle regular app messages
            if (data.type === 'status' && !isDebugPanelOpen) {
              switch (data.status) {
                case 'transcribing':
                  setStatus('Transcribing your message...');
                  break;
                case 'generating_response':
                  setStatus('Generating response...');
                  break;
                case 'generating_audio':
                  setStatus('Converting to speech...');
                  break;
                case 'playing_audio':
                  setStatus('Playing response...');
                  break;
              }
            } else if (data.type === 'user_transcription') {
              setMessages(prev => [...prev, { 
                id: Date.now(),
                text: data.text,
                isAI: false,
                isStreaming: false
              }]);
            } else if (data.type === 'ai_response') {
              const messageId = Date.now();
              setMessages(prev => [...prev, { 
                id: messageId,
                text: '',
                isAI: true,
                isStreaming: true
              }]);
              streamText(data.text, messageId);
            } else if (data.error && !isDebugPanelOpen) {
              setAudioState(prev => ({ ...prev, error: data.error }));
              setStatus(data.error);
            }
          } catch (e) {
            console.error('Error parsing WebSocket message:', e);
          }
        }
      };

      wsRef.current.onerror = () => {
        setAudioState(prev => ({ 
          ...prev, 
          error: 'Connection error. Please check if the server is running.',
          wsConnected: false
        }));
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setAudioState(prev => ({ 
        ...prev, 
        error: 'Failed to create WebSocket connection',
        wsConnected: false
      }));
    }
  }, [streamText]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      connectionAttempts.current = MAX_RECONNECT_ATTEMPTS;
      if (wsReconnectTimeout.current) {
        clearTimeout(wsReconnectTimeout.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWebSocket]);

  const startRecording = async () => {
    try {
      if (!audioProcessor.current) {
        await initializeAudio();
      }

      if (audioProcessor.current) {
        audioProcessor.current.port.postMessage({ command: 'start' });
        setAudioState(prev => ({ ...prev, isListening: true }));
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      setAudioState(prev => ({ ...prev, error: 'Failed to start recording' }));
    }
  };

  const stopRecording = async () => {
    try {
      if (audioProcessor.current) {
        audioProcessor.current.port.postMessage({ command: 'stop' });
        setAudioState(prev => ({ ...prev, isListening: false }));
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setAudioState(prev => ({ ...prev, error: 'Failed to stop recording' }));
    }
  };

  // Load conversations
  useEffect(() => {
    const loadConversations = async () => {
      try {
        const response = await fetch('http://localhost:8000/conversations');
        const data = await response.json();
        setConversations(data);
      } catch (error) {
        console.error('Error loading conversations:', error);
      }
    };
    loadConversations();
  }, []);

  // Load conversation messages when selecting a conversation
  useEffect(() => {
    const loadMessages = async () => {
      if (currentConversation) {
        try {
          const response = await fetch(`http://localhost:8000/conversations/${currentConversation}/messages`);
          const data = await response.json();
          setMessages(data.map((msg: any) => ({
            id: msg.id,
            text: msg.text,
            isAI: msg.is_ai,
            isStreaming: false
          })));
        } catch (error) {
          console.error('Error loading messages:', error);
        }
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
        
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // Send stop recording signal for debug mode
          wsRef.current.send(JSON.stringify({
            type: 'debug',
            action: 'stop_recording'
          }));
        }

        if (debugAudioStream.current) {
          debugAudioStream.current.getTracks().forEach(track => track.stop());
          debugAudioStream.current = null;
        }

        if (debugAudioProcessor.current) {
          debugAudioProcessor.current.disconnect();
          debugAudioProcessor.current = null;
        }
      } catch (error) {
        console.error('Error stopping test recording:', error);
        setDebugState(prev => ({ ...prev, debugStatus: 'Failed to stop recording' }));
      }
    } else {
      // Start recording
      try {
        const ctx = audioContext.current;  // Store reference to avoid null checks
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });

        debugAudioStream.current = stream;
        const source = ctx.createMediaStreamSource(stream);
        debugAudioProcessor.current = new AudioWorkletNode(ctx, 'audio-processor');

        debugAudioProcessor.current.port.onmessage = (event) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(event.data);
          }
        };

        source.connect(debugAudioProcessor.current);
        
        // Send recording start signal with debug flag
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'debug',
            action: 'start_recording'
          }));
        }

        setDebugState(prev => ({ 
          ...prev, 
          isRecordingTest: true, 
          debugStatus: 'Recording test audio... (5 seconds)',
          lastTranscription: null // Clear previous transcription
        }));

        // Store the timeout ID so we can clear it if needed
        const timeoutId = setTimeout(() => {
          console.log('Debug recording timeout reached, stopping...');
          testTranscription(); // This will trigger the stop recording logic
        }, 5000);

        // Clean up the timeout if the component unmounts
        return () => clearTimeout(timeoutId);
      } catch (error) {
        console.error('Error starting test recording:', error);
        setDebugState(prev => ({ ...prev, debugStatus: 'Failed to start recording' }));
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

  const ThinkingIndicator = () => (
    <div className="flex items-center space-x-2 p-4 bg-[#1E1E1E] rounded-2xl rounded-bl-none shadow-lg">
      <div className="flex space-x-1">
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1, repeatDelay: 0.2 }}
          className="w-2 h-2 bg-blue-400/50 rounded-full"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1, delay: 0.2, repeatDelay: 0.2 }}
          className="w-2 h-2 bg-blue-400/50 rounded-full"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1, delay: 0.4, repeatDelay: 0.2 }}
          className="w-2 h-2 bg-blue-400/50 rounded-full inline-block"
        />
      </div>
    </div>
  );

  const DebugModal = () => {
    // Only render the modal content when it's open
    if (!isDebugPanelOpen) return null;

    const modalContent = (
      <>
        <div
          className="fixed inset-0 bg-black bg-opacity-50"
          onClick={() => setIsDebugPanelOpen(false)}
        />
        <div
          className="fixed inset-x-0 bottom-0 p-6 bg-[#1A1A1A] border-t border-white/5 rounded-t-2xl shadow-2xl"
        >
          <div className="max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-white">Debug Panel</h2>
              <button
                onClick={() => setIsDebugPanelOpen(false)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-white/70" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Audio System Tests */}
              <div className="space-y-4 p-4 bg-white/5 rounded-xl">
                <h3 className="text-sm font-medium text-white/70">Audio System</h3>
                <div className="space-y-2">
                  <button
                    onClick={testMicrophoneRecording}
                    className="w-full p-3 flex items-center justify-center space-x-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg transition-colors"
                  >
                    <Mic className="w-4 h-4" />
                    <span>Test Recording (3s)</span>
                  </button>
                  <button
                    onClick={() => debugState.recordedAudio && playAudioResponse(debugState.recordedAudio)}
                    disabled={!debugState.recordedAudio}
                    className="w-full p-3 flex items-center justify-center space-x-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-4 h-4" />
                    <span>Play Last Recording</span>
                  </button>
                </div>
              </div>

              {/* Connection Tests */}
              <div className="space-y-4 p-4 bg-white/5 rounded-xl">
                <h3 className="text-sm font-medium text-white/70">Connection</h3>
                <div className="space-y-2">
                  <button
                    onClick={connectWebSocket}
                    className="w-full p-3 flex items-center justify-center space-x-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Reconnect WebSocket</span>
                  </button>
                  <div className="p-2 bg-white/5 rounded-lg">
                    <p className="text-xs text-white/50">
                      Status: {audioState.wsConnected ? 'Connected' : 'Disconnected'}
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Tests */}
              <div className="space-y-4 p-4 bg-white/5 rounded-xl">
                <h3 className="text-sm font-medium text-white/70">AI System</h3>
                <div className="space-y-2">
                  <button
                    onClick={testTranscription}
                    className="w-full p-3 flex items-center justify-center space-x-2 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded-lg transition-colors"
                  >
                    <Settings2 className="w-4 h-4" />
                    <span>
                      {debugState.isRecordingTest ? 'Stop Recording' : 'Test Transcription'}
                    </span>
                  </button>
                  <button
                    onClick={testLLMConnection}
                    className="w-full p-3 flex items-center justify-center space-x-2 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 rounded-lg transition-colors"
                  >
                    <Wand2 className="w-4 h-4" />
                    <span>Test LLM</span>
                  </button>
                </div>
              </div>

              {/* TTS Tests */}
              <div className="space-y-4 p-4 bg-white/5 rounded-xl">
                <h3 className="text-sm font-medium text-white/70">Text to Speech</h3>
                <div className="space-y-2">
                  <button
                    onClick={testTTSConnection}
                    className="w-full p-3 flex items-center justify-center space-x-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>Test TTS</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Status Display */}
            <div className="mt-6 p-4 bg-white/5 rounded-xl">
              <h3 className="text-sm font-medium text-white/70 mb-2">Debug Log</h3>
              <div className="space-y-1">
                {debugState.lastTranscription && (
                  <p className="text-xs text-white/50">Last Transcription: {debugState.lastTranscription}</p>
                )}
                {debugState.lastLLMResponse && (
                  <p className="text-xs text-white/50">Last LLM Response: {debugState.lastLLMResponse}</p>
                )}
                {debugState.debugStatus && (
                  <p className="text-xs text-white/50">Status: {debugState.debugStatus}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    );

    // Use createPortal to render the modal outside the main component tree
    return createPortal(modalContent, document.body);
  };

  const initializeAudio = async () => {
    try {
      if (!audioContext.current) {
        audioContext.current = new AudioContext();
        await audioContext.current.audioWorklet.addModule('/audioProcessor.js');
      }

      if (audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      audioStream.current = stream;
      const source = audioContext.current.createMediaStreamSource(stream);
      audioProcessor.current = new AudioWorkletNode(audioContext.current, 'audio-processor');

      audioProcessor.current.port.onmessage = (event) => {
        if (event.data.type === 'audioData' && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data.buffer);
        } else if (event.data.type === 'recordingComplete' && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(new Uint8Array([0])); // Signal end of recording
        }
      };

      source.connect(audioProcessor.current);
      setAudioState(prev => ({ ...prev, isInitialized: true, error: null }));
    } catch (error) {
      console.error('Error initializing audio:', error);
      setAudioState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to initialize audio',
        isInitialized: false
      }));
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="h-screen w-full bg-[#0A0A0A] flex"
    >
      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black"
              onClick={() => setIsSidebarOpen(false)}
            />
            <motion.div 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-80 bg-[#1A1A1A] border-r border-white/5 shadow-2xl z-50"
            >
              <div className="flex items-center justify-between p-6">
                <motion.h2 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xl font-semibold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent"
                >
                  Conversation History
                </motion.h2>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5 text-white/70" />
                </motion.button>
              </div>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="overflow-y-auto h-full py-4 space-y-2 px-4"
              >
                {conversations.map((conv, index) => (
                  <motion.button
                    key={conv.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => {
                      setCurrentConversation(conv.id);
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full p-4 flex items-center space-x-3 rounded-xl transition-all ${
                      currentConversation === conv.id 
                        ? 'bg-white/15 shadow-lg' 
                        : 'hover:bg-white/10'
                    }`}
                  >
                    <MessageSquare className="w-5 h-5 text-blue-400" />
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium text-white/90 truncate">
                        {conv.title}
                      </p>
                      <p className="text-xs text-white/50">
                        {new Date(conv.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Render DebugModal outside AnimatePresence */}
      <DebugModal />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Messages Container */}
        <motion.div 
          layout
          className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
        >
          <AnimatePresence mode="popLayout">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`flex ${message.isAI ? 'justify-start' : 'justify-end'}`}
              >
                <motion.div 
                  layout="position"
                  className={`max-w-[70%] p-4 rounded-2xl shadow-lg ${
                    message.isAI 
                      ? 'bg-[#1E1E1E] text-white rounded-bl-none'
                      : 'bg-blue-600 text-white rounded-br-none'
                  }`}
                >
                  <p className="text-base whitespace-pre-wrap">
                    {message.text}
                    {message.isStreaming && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="inline-block w-2 h-4 ml-1 bg-blue-400/50"
                      />
                    )}
                  </p>
                </motion.div>
              </motion.div>
            ))}
          </AnimatePresence>
          <AnimatePresence>
            {status === 'Generating response...' && messages.length > 0 && !messages[messages.length - 1].isStreaming && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex justify-start"
              >
                <div className="p-4 bg-[#1E1E1E] rounded-2xl rounded-bl-none shadow-lg">
                  <div className="flex space-x-2">
                    <motion.span
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="w-2 h-2 bg-blue-400/50 rounded-full"
                    />
                    <motion.span
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, delay: 0.2, repeat: Infinity }}
                      className="w-2 h-2 bg-blue-400/50 rounded-full"
                    />
                    <motion.span
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, delay: 0.4, repeat: Infinity }}
                      className="w-2 h-2 bg-blue-400/50 rounded-full"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </motion.div>

        {/* Status Bar */}
        <motion.div 
          layout
          className="px-6 py-2 bg-[#1A1A1A] border-t border-white/5"
        >
          <div className="max-w-screen-sm mx-auto">
            <AnimatePresence mode="wait">
              {(status || audioState.error || (!audioState.wsConnected && !audioState.error)) && (
                <motion.div 
                  key={status || 'error'} // Force remount on status change
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
                   !audioState.wsConnected ? 'Connecting to server...' :
                   status}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Footer Controls */}
        <motion.div 
          layout
          className="px-6 py-4 bg-[#1A1A1A] border-t border-white/5"
        >
          <div className="max-w-screen-sm mx-auto flex justify-between items-center">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsSidebarOpen(true)}
              className="p-3 rounded-xl hover:bg-white/5 transition-colors"
            >
              <Menu className="w-6 h-6 text-white/70" />
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={audioState.isListening ? stopRecording : startRecording}
              disabled={!audioState.isInitialized || processingRef.current || !audioState.wsConnected}
              className={`p-6 rounded-2xl transition-all duration-300 shadow-lg ${
                !audioState.isInitialized || !audioState.wsConnected
                  ? 'bg-neutral-800 cursor-not-allowed'
                  : audioState.isListening
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <motion.div
                animate={audioState.isListening ? { scale: [1, 1.2, 1] } : {}}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                {audioState.isListening ? (
                  <MicOff className="w-8 h-8 text-white" />
                ) : (
                  <Mic className="w-8 h-8 text-white" />
                )}
              </motion.div>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsDebugPanelOpen(true)}
              className="p-3 rounded-xl hover:bg-white/5 transition-colors"
            >
              <Bug className="w-6 h-6 text-white/70" />
            </motion.button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default VoiceAssistant;
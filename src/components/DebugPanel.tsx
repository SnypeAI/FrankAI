import React from 'react';
import { createPortal } from 'react-dom';
import { X, Mic, Play, RefreshCw, Settings2, Wand2, Volume2 } from 'lucide-react';

interface DebugState {
  recordedAudio: Uint8Array | null;
  lastTranscription: string | null;
  lastLLMResponse: string | null;
  lastTTSAudio: Uint8Array | null;
  debugStatus: string;
  isRecordingTest: boolean;
}

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
  debugState: DebugState;
  setDebugState: React.Dispatch<React.SetStateAction<DebugState>>;
  audioState: {
    wsConnected: boolean;
  };
  testMicrophoneRecording: () => Promise<void>;
  testTranscription: () => Promise<void>;
  testLLMConnection: () => Promise<void>;
  testTTSConnection: () => Promise<void>;
  connectWebSocket: () => void;
  playAudioResponse: (audioData: Uint8Array) => Promise<void>;
}

const DebugPanel: React.FC<DebugPanelProps> = ({
  isOpen,
  onClose,
  debugState,
  setDebugState,
  audioState,
  testMicrophoneRecording,
  testTranscription,
  testLLMConnection,
  testTTSConnection,
  connectWebSocket,
  playAudioResponse
}) => {
  if (!isOpen) return null;

  const modalContent = (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      <div
        className="fixed inset-x-0 bottom-0 p-6 bg-[#1A1A1A] border-t border-white/5 rounded-t-2xl shadow-2xl"
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-white">Debug Panel</h2>
            <button
              onClick={onClose}
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

  return createPortal(modalContent, document.body);
};

export default DebugPanel; 
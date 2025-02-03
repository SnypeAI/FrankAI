import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Wand2, Volume2, Settings2, CheckCircle2, XCircle, Star, UserCircle2, Plus, Wrench, Cloud, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import ConfirmationModal from './ConfirmationModal';

interface Settings {
  elevenlabs_api_key: string | null;
  elevenlabs_voice_id: string | null;
  llm_api_endpoint: string;
  llm_model: string;
  llm_temperature: number;
  llm_max_tokens: number;
}

interface SavedConfig {
  id: number;
  name: string;
  endpoint: string;
  model: string;
  temperature: string;
  max_tokens: string;
  elevenlabs_api_key: string | null;
  elevenlabs_voice_id: string | null;
  is_default: boolean;
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

interface LLMModel {
  id: string;
  name?: string;
  object: string;
  owned_by: string;
  size?: number;
  family?: string;
}

interface ModelFilters {
  showUncensored: boolean;
  modelFamily: string;
  sizeRange: string;
  sortBy: 'name' | 'size';
  sortDirection: 'asc' | 'desc';
}

interface ToolConfig {
  tool_name: string;
  config_key: string;
  config_value: string | null;
  is_enabled: boolean;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onUpdateSetting: (key: string, value: string) => Promise<void>;
  onRemoveSetting: (key: string) => Promise<void>;
  savedConfigs: SavedConfig[];
  onSaveConfig: (name: string) => Promise<void>;
  isSavingConfig: boolean;
  isTestingConfig: boolean;
  availableModels: LLMModel[];
  isLoadingModels: boolean;
  onFetchModels: (endpoint: string) => Promise<void>;
  onDeleteConfig: (id: number) => Promise<void>;
  onUpdateConfig: (id: number, config: Partial<SavedConfig>) => Promise<void>;
  onSetDefaultConfig: (id: number) => Promise<void>;
  toolConfigs: Record<string, any>;
  onUpdateToolConfig: (toolName: string, configKey: string, configValue: string) => Promise<void>;
  onSetToolEnabled: (toolName: string, isEnabled: boolean) => Promise<void>;
}

const SaveConfigForm = ({ onSave, isSaving, isTesting }: { 
  onSave: (name: string) => void;
  isSaving: boolean;
  isTesting: boolean;
}) => {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name) {
      onSave(name);
      setName('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Enter config name"
        className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-xs"
      />
      <button
        type="submit"
        disabled={isSaving || isTesting || !name}
        className={`w-full p-2 rounded-lg text-xs transition-colors ${
          isSaving || isTesting || !name
            ? 'bg-white/5 text-white/30 cursor-not-allowed'
            : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400'
        }`}
      >
        {isTesting ? 'Testing Connection...' : 
         isSaving ? 'Saving...' : 'Save Current Config'}
      </button>
    </form>
  );
};

// Add voice testing function
const testElevenLabsVoice = async (apiKey: string, voiceId: string) => {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: "ElevenLabs was connected correctly",
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to generate voice test');
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    await audio.play();

    // Clean up the URL after playing
    audio.onended = () => URL.revokeObjectURL(audioUrl);

    return true;
  } catch (error) {
    console.error('Voice test failed:', error);
    return false;
  }
};

// Add LLM testing function
const testLLMConnection = async (endpoint: string, model: string): Promise<boolean> => {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: "Test connection" }],
        max_tokens: 5
      })
    });

    if (!response.ok) {
      throw new Error('Failed to connect to LLM');
    }

    return true;
  } catch (error) {
    console.error('LLM connection test failed:', error);
    return false;
  }
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSetting,
  onRemoveSetting,
  savedConfigs,
  onSaveConfig,
  isSavingConfig,
  isTestingConfig,
  availableModels,
  isLoadingModels,
  onFetchModels,
  onDeleteConfig,
  onUpdateConfig,
  onSetDefaultConfig,
  toolConfigs = {},
  onUpdateToolConfig,
  onSetToolEnabled,
}) => {
  const [activeTab, setActiveTab] = useState('llm');
  const [formInputs, setFormInputs] = useState({
    llm_api_endpoint: settings.llm_api_endpoint || '',
    llm_model: settings.llm_model || '',
    llm_temperature: settings.llm_temperature?.toString() || '0.7',
    llm_max_tokens: settings.llm_max_tokens?.toString() || '1000',
    elevenlabs_api_key: settings.elevenlabs_api_key || '',
    elevenlabs_voice_id: settings.elevenlabs_voice_id || ''
  });
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [llmConnectionStatus, setLLMConnectionStatus] = useState<boolean | null>(null);
  const [isTestingLLM, setIsTestingLLM] = useState(false);
  const [settingToRemove, setSettingToRemove] = useState<string | null>(null);
  const [configToDelete, setConfigToDelete] = useState<SavedConfig | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<SavedConfig | null>(null);
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [newPersonality, setNewPersonality] = useState({ name: '', system_prompt: '' });
  const [isAddingPersonality, setIsAddingPersonality] = useState(false);
  const [personalityToDelete, setPersonalityToDelete] = useState<Personality | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [filters, setFilters] = useState<ModelFilters>({
    showUncensored: false,
    modelFamily: '',
    sizeRange: '',
    sortBy: 'name',
    sortDirection: 'asc'
  });

  // Update form inputs when settings change
  useEffect(() => {
    setFormInputs({
      llm_api_endpoint: settings.llm_api_endpoint || '',
      llm_model: settings.llm_model || '',
      llm_temperature: settings.llm_temperature?.toString() || '0.7',
      llm_max_tokens: settings.llm_max_tokens?.toString() || '1000',
      elevenlabs_api_key: settings.elevenlabs_api_key || '',
      elevenlabs_voice_id: settings.elevenlabs_voice_id || ''
    });
  }, [settings]);

  useEffect(() => {
    // Initialize WebSocket connection when panel opens
    if (isOpen) {
      wsRef.current = new WebSocket('ws://localhost:3000');
      wsRef.current.onmessage = handleWebSocketMessage;
      wsRef.current.onopen = () => {
        // Fetch personalities when connection is established
        wsRef.current?.send(JSON.stringify({ type: 'get_personalities' }));
      };
    }

    // Cleanup WebSocket connection when panel closes
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isOpen]);

  const handleWebSocketMessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'personalities':
        setPersonalities(data.personalities);
        break;
      case 'personality_added':
        setPersonalities(prev => [data.personality, ...prev]);
        setNewPersonality({ name: '', system_prompt: '' });
        setIsAddingPersonality(false);
        break;
      case 'personality_default_set':
        setPersonalities(prev => prev.map(p => ({
          ...p,
          is_default: p.id === data.personality.id
        })));
        break;
      case 'personality_deleted':
        if (data.success) {
          setPersonalities(prev => prev.filter(p => p.id !== data.id));
          setPersonalityToDelete(null);
        }
        break;
    }
  };

  const handleAddPersonality = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'add_personality',
        name: newPersonality.name,
        system_prompt: newPersonality.system_prompt
      }));
    }
  };

  const handleSetDefaultPersonality = (id: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'set_default_personality',
        id
      }));
    }
  };

  const handleDeletePersonality = (id: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'delete_personality',
        id
      }));
    }
  };

  // Helper functions
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

  // Size ranges for filtering
  const sizeRanges = [
    { label: 'All Sizes', value: '' },
    { label: '1-7B', value: '1-7' },
    { label: '8-13B', value: '8-13' },
    { label: '14-30B', value: '14-30' },
    { label: '31-70B', value: '31-70' },
    { label: '70B+', value: '70-999' }
  ];

  const handleInputChange = (key: string, value: string) => {
    setFormInputs(prev => ({ ...prev, [key]: value }));
  };

  // Process models with additional metadata
  const processedModels = availableModels.map(model => ({
    ...model,
    size: getModelSize(model.id),
    family: getModelFamily(model.id)
  }));

  // Get unique model families
  const modelFamilies = Array.from(new Set(processedModels.map(model => model.family))).sort();

  // Filter and sort models
  const filteredModels = processedModels
    .filter(model => {
      if (filters.showUncensored && !model.id.toLowerCase().includes('uncensored')) {
        return false;
      }
      if (filters.modelFamily && model.family !== filters.modelFamily) {
        return false;
      }
      if (filters.sizeRange) {
        const [min, max] = filters.sizeRange.split('-').map(Number);
        if (model.size < min || (max && model.size > max)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      const direction = filters.sortDirection === 'asc' ? 1 : -1;
      if (filters.sortBy === 'size') {
        return (a.size - b.size) * direction;
      }
      return a.id.localeCompare(b.id) * direction;
    });

  const tabs = [
    { id: 'llm', label: 'LLM', icon: Wand2 },
    { id: 'voice', label: 'Voice', icon: Volume2 },
    { id: 'tools', label: 'Tools', icon: Wrench },
    { id: 'personalities', label: 'Personalities', icon: UserCircle2 },
    { id: 'system', label: 'System', icon: Settings2 }
  ];

  const handleRemoveSetting = async (key: string) => {
    setSettingToRemove(key);
  };

  const confirmRemoveSetting = async () => {
    if (settingToRemove) {
      await onRemoveSetting(settingToRemove);
      setSettingToRemove(null);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      {/* Left Side - Saved Configs */}
      <div className="fixed left-0 top-0 bottom-0 w-64 bg-[#1A1A1A] border-r border-white/5 flex flex-col">
        {/* Saved Configurations List */}
        <div className="flex-1 p-4 overflow-y-auto">
          <h3 className="text-sm font-medium text-white/70 mb-4">Saved Configurations</h3>
          <div className="space-y-2">
            {savedConfigs.map((config) => (
              <motion.div
                key={config.id}
                className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all group"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-white/90">{config.name}</h4>
                    <button
                      onClick={() => onSetDefaultConfig(config.id)}
                      className={`transition-opacity ${config.is_default ? 'text-yellow-500' : 'text-white/30 hover:text-yellow-500/70'}`}
                    >
                      <Star className="w-4 h-4" fill={config.is_default ? "#EAB308" : "none"} />
                    </button>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfigToDelete(config);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/20 rounded"
                  >
                    <X className="w-3 h-3 text-red-400" />
                  </button>
                </div>
                <div 
                  className="cursor-pointer"
                  onClick={() => {
                    onUpdateSetting('llm_api_endpoint', config.endpoint);
                    onUpdateSetting('llm_model', config.model);
                    onUpdateSetting('llm_temperature', config.temperature);
                    onUpdateSetting('llm_max_tokens', config.max_tokens);
                    if (config.elevenlabs_api_key) {
                      onUpdateSetting('elevenlabs_api_key', config.elevenlabs_api_key);
                    }
                    if (config.elevenlabs_voice_id) {
                      onUpdateSetting('elevenlabs_voice_id', config.elevenlabs_voice_id);
                    }
                    setSelectedConfig(config);
                  }}
                >
                  <p className="text-xs text-white/50">Model: {config.model}</p>
                  <p className="text-xs text-white/50">Temperature: {config.temperature}</p>
                  {config.elevenlabs_voice_id && (
                    <p className="text-xs text-white/50">Voice ID: {config.elevenlabs_voice_id}</p>
                  )}
                </div>
              </motion.div>
            ))}
            {savedConfigs.length === 0 && (
              <p className="text-sm text-white/50 italic">No saved configurations</p>
            )}
          </div>
        </div>

        {/* Save/Update Config Section */}
        <div className="p-4 border-t border-white/5 bg-black/20 space-y-4">
          <div>
            <h4 className="text-xs font-medium text-white/70 mb-2">Save Current Config</h4>
            <SaveConfigForm
              onSave={onSaveConfig}
              isSaving={isSavingConfig}
              isTesting={isTestingConfig}
            />
          </div>

          {selectedConfig && (
            <div>
              <button
                onClick={() => onUpdateConfig(selectedConfig.id, {
                  endpoint: settings.llm_api_endpoint,
                  model: settings.llm_model,
                  temperature: settings.llm_temperature?.toString(),
                  max_tokens: settings.llm_max_tokens?.toString(),
                  elevenlabs_api_key: settings.elevenlabs_api_key,
                  elevenlabs_voice_id: settings.elevenlabs_voice_id
                })}
                className="w-full p-2 rounded-lg text-xs transition-colors bg-purple-600/20 hover:bg-purple-600/30 text-purple-400"
              >
                Update "{selectedConfig.name}"
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Side - Active Settings */}
      <div className="fixed right-0 top-0 bottom-0 w-64 p-4 bg-[#1A1A1A] border-l border-white/5 overflow-y-auto">
        <h3 className="text-sm font-medium text-white/70 mb-4">Active Settings</h3>
        <div className="space-y-2">
          {Object.entries(settings).map(([key, value]) => {
            if (!value) return null;
            return (
              <div
                key={key}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${getChipColor(key)} shadow-lg transition-all duration-200 hover:shadow-xl`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-white truncate block">
                    {getReadableName(key)}: {getDisplayValue(key, String(value))}
                  </span>
                </div>
                <button
                  onClick={() => handleRemoveSetting(key)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-2"
                >
                  <X className="w-3 h-3 text-white/90 hover:text-white" />
                </button>
              </div>
            );
          })}
          {Object.values(settings).every(value => !value) && (
            <p className="text-sm text-white/50 italic">No settings configured</p>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Delete */}
      <ConfirmationModal
        isOpen={configToDelete !== null}
        onClose={() => setConfigToDelete(null)}
        onConfirm={async () => {
          if (configToDelete) {
            await onDeleteConfig(configToDelete.id);
            if (selectedConfig?.id === configToDelete.id) {
              setSelectedConfig(null);
            }
          }
        }}
        title="Delete Configuration"
        message={`Are you sure you want to delete "${configToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        isDanger={true}
      />

      {/* Main Settings Area */}
      <div className="fixed left-64 right-64 bottom-0 top-0 bg-[#1A1A1A] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-[#1A1A1A] border-b border-white/5">
          <div className="flex justify-between items-center p-6">
            <h2 className="text-xl font-semibold text-white">Settings</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-white/70" />
            </button>
          </div>
          
          {/* Tabs */}
          <div className="px-6 pb-4 flex space-x-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:bg-white/5'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'llm' && (
            <div className="space-y-6">
              {/* LLM Settings Content */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/70 mb-1">API Endpoint</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={formInputs.llm_api_endpoint}
                      onChange={(e) => handleInputChange('llm_api_endpoint', e.target.value)}
                      onBlur={async () => {
                        await onUpdateSetting('llm_api_endpoint', formInputs.llm_api_endpoint);
                        if (formInputs.llm_api_endpoint && formInputs.llm_model) {
                          setIsTestingLLM(true);
                          const success = await testLLMConnection(formInputs.llm_api_endpoint, formInputs.llm_model);
                          setLLMConnectionStatus(success);
                          setIsTestingLLM(false);
                        }
                      }}
                      className="flex-1 p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                      placeholder="Enter LLM API endpoint"
                    />
                    <button
                      onClick={() => onFetchModels(formInputs.llm_api_endpoint)}
                      disabled={!formInputs.llm_api_endpoint || isLoadingModels}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        !formInputs.llm_api_endpoint || isLoadingModels
                          ? 'bg-white/5 text-white/30 cursor-not-allowed'
                          : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400'
                      }`}
                    >
                      {isLoadingModels ? 'Loading...' : 'Fetch Models'}
                    </button>
                  </div>
                </div>

                {/* Model Selection and Filters */}
                {availableModels.length > 0 && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-white/70 mb-1">Sort By</label>
                        <select
                          value={filters.sortBy}
                          onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            sortBy: e.target.value as 'name' | 'size'
                          }))}
                          className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                        >
                          <option value="name">Name</option>
                          <option value="size">Size</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-white/70 mb-1">Direction</label>
                        <select
                          value={filters.sortDirection}
                          onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            sortDirection: e.target.value as 'asc' | 'desc'
                          }))}
                          className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                        >
                          <option value="asc">Ascending</option>
                          <option value="desc">Descending</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-white/70 mb-1">Model Family</label>
                        <select
                          value={filters.modelFamily}
                          onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            modelFamily: e.target.value
                          }))}
                          className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                        >
                          <option value="">All Families</option>
                          {modelFamilies.map(family => (
                            <option key={family} value={family}>
                              {family.charAt(0).toUpperCase() + family.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-white/70 mb-1">Size Range</label>
                        <select
                          value={filters.sizeRange}
                          onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            sizeRange: e.target.value
                          }))}
                          className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                        >
                          {sizeRanges.map(range => (
                            <option key={range.value} value={range.value}>
                              {range.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="showUncensored"
                        checked={filters.showUncensored}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          showUncensored: e.target.checked
                        }))}
                        className="rounded bg-black/20 border-white/10"
                      />
                      <label htmlFor="showUncensored" className="text-sm text-white/70">
                        Show only uncensored models
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm text-white/70 mb-1">
                        Model ({filteredModels.length} models)
                      </label>
                      <select
                        value={formInputs.llm_model}
                        onChange={(e) => {
                          handleInputChange('llm_model', e.target.value);
                          onUpdateSetting('llm_model', e.target.value);
                          if (formInputs.llm_api_endpoint && e.target.value) {
                            setIsTestingLLM(true);
                            testLLMConnection(formInputs.llm_api_endpoint, e.target.value)
                              .then(success => {
                                setLLMConnectionStatus(success);
                                setIsTestingLLM(false);
                              });
                          }
                        }}
                        className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                      >
                        <option value="">Select a model</option>
                        {filteredModels.map(model => (
                          <option key={model.id} value={model.id}>
                            {model.family.toUpperCase()} - {model.id} ({model.size}B)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Connection Status */}
                    {(isTestingLLM || llmConnectionStatus !== null) && (
                      <div className={`flex items-center space-x-2 p-2 rounded-lg ${
                        isTestingLLM 
                          ? 'bg-yellow-500/10 text-yellow-400'
                          : llmConnectionStatus
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-red-500/10 text-red-400'
                      }`}>
                        {isTestingLLM ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-yellow-400 border-t-transparent" />
                            <span className="text-sm">Testing connection...</span>
                          </>
                        ) : llmConnectionStatus ? (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-sm">Connection successful</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4" />
                            <span className="text-sm">Connection failed</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Temperature and Max Tokens */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-white/70 mb-1">Temperature</label>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={formInputs.llm_temperature}
                      onChange={(e) => handleInputChange('llm_temperature', e.target.value)}
                      onBlur={() => onUpdateSetting('llm_temperature', formInputs.llm_temperature.toString())}
                      className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-white/70 mb-1">Max Tokens</label>
                    <input
                      type="number"
                      min="1"
                      value={formInputs.llm_max_tokens}
                      onChange={(e) => handleInputChange('llm_max_tokens', e.target.value)}
                      onBlur={() => onUpdateSetting('llm_max_tokens', formInputs.llm_max_tokens.toString())}
                      className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'voice' && (
            <div className="space-y-6">
              {/* ElevenLabs Settings */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/70 mb-1">API Key</label>
                  <input
                    type="password"
                    value={formInputs.elevenlabs_api_key}
                    onChange={(e) => handleInputChange('elevenlabs_api_key', e.target.value)}
                    onBlur={() => onUpdateSetting('elevenlabs_api_key', formInputs.elevenlabs_api_key)}
                    className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                    placeholder="Enter ElevenLabs API key"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/70 mb-1">Voice ID</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={formInputs.elevenlabs_voice_id}
                      onChange={(e) => handleInputChange('elevenlabs_voice_id', e.target.value)}
                      onBlur={async () => {
                        await onUpdateSetting('elevenlabs_voice_id', formInputs.elevenlabs_voice_id);
                        if (formInputs.elevenlabs_voice_id && formInputs.elevenlabs_api_key) {
                          setIsTestingVoice(true);
                          await testElevenLabsVoice(formInputs.elevenlabs_api_key, formInputs.elevenlabs_voice_id);
                          setIsTestingVoice(false);
                        }
                      }}
                      className="flex-1 p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                      placeholder="Enter voice ID"
                    />
                    {isTestingVoice && (
                      <div className="flex items-center px-3 text-white/50 text-sm">
                        Testing...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="space-y-6">
              {/* Weather Tool Settings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Cloud className="w-5 h-5 text-blue-400" />
                    <h3 className="text-lg font-medium text-white">Weather Tool</h3>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={toolConfigs?.weather?.is_enabled || false}
                      onChange={(e) => onSetToolEnabled('weather', e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                <div>
                  <label className="block text-sm text-white/70 mb-1">OpenWeather API Key</label>
                  <input
                    type="password"
                    value={toolConfigs?.weather?.openweather_api_key || ''}
                    onChange={(e) => onUpdateToolConfig('weather', 'openweather_api_key', e.target.value)}
                    className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                    placeholder="Enter OpenWeather API key"
                  />
                </div>
              </div>

              {/* Google Search Tool Settings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Search className="w-5 h-5 text-green-400" />
                    <h3 className="text-lg font-medium text-white">Google Search Tool</h3>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={toolConfigs?.google_search?.is_enabled || false}
                      onChange={(e) => onSetToolEnabled('google_search', e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                <div>
                  <label className="block text-sm text-white/70 mb-1">Google API Key</label>
                  <input
                    type="password"
                    value={toolConfigs?.google_search?.api_key || ''}
                    onChange={(e) => onUpdateToolConfig('google_search', 'api_key', e.target.value)}
                    className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                    placeholder="Enter Google API key"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/70 mb-1">Search Engine ID</label>
                  <input
                    type="text"
                    value={toolConfigs?.google_search?.search_engine_id || ''}
                    onChange={(e) => onUpdateToolConfig('google_search', 'search_engine_id', e.target.value)}
                    className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                    placeholder="Enter Google Search Engine ID"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'personalities' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-white">Personalities</h3>
                <button
                  onClick={() => setIsAddingPersonality(true)}
                  className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Personality</span>
                </button>
              </div>

              {isAddingPersonality && (
                <div className="space-y-4 p-4 bg-white/5 rounded-lg">
                  <div>
                    <label className="block text-sm text-white/70 mb-1">Name</label>
                    <input
                      type="text"
                      value={newPersonality.name}
                      onChange={(e) => setNewPersonality(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                      placeholder="Enter personality name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-white/70 mb-1">System Prompt</label>
                    <textarea
                      value={newPersonality.system_prompt}
                      onChange={(e) => setNewPersonality(prev => ({ ...prev, system_prompt: e.target.value }))}
                      className="w-full h-32 p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm resize-none"
                      placeholder="Enter system prompt"
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => setIsAddingPersonality(false)}
                      className="px-4 py-2 rounded-lg text-white/50 hover:text-white/70 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddPersonality}
                      disabled={!newPersonality.name || !newPersonality.system_prompt}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        !newPersonality.name || !newPersonality.system_prompt
                          ? 'bg-white/5 text-white/30 cursor-not-allowed'
                          : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400'
                      }`}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {personalities.map((personality) => (
                  <motion.div
                    key={personality.id}
                    className="p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-all group"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-white/90">{personality.name}</h4>
                        {personality.is_builtin && (
                          <span className="px-2 py-1 text-xs rounded-full bg-purple-500/20 text-purple-400">
                            Built-in
                          </span>
                        )}
                        <button
                          onClick={() => handleSetDefaultPersonality(personality.id)}
                          className={`transition-opacity ${personality.is_default ? 'text-green-500' : 'text-white/30 hover:text-green-500/70'}`}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      </div>
                      {!personality.is_builtin && (
                        <button
                          onClick={() => setPersonalityToDelete(personality)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-4 h-4 text-red-400" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-white/50">{personality.system_prompt}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'system' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Volume2 className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-medium text-white">ElevenLabs Integration</h3>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={toolConfigs.elevenlabs_tts?.is_enabled || false}
                      onChange={(e) => onSetToolEnabled('elevenlabs_tts', e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                <p className="text-sm text-white/50">Enable or disable ElevenLabs text-to-speech for AI responses</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Deleting Personality */}
      <ConfirmationModal
        isOpen={personalityToDelete !== null}
        onClose={() => setPersonalityToDelete(null)}
        onConfirm={() => {
          if (personalityToDelete) {
            handleDeletePersonality(personalityToDelete.id);
          }
        }}
        title="Delete Personality"
        message={`Are you sure you want to delete "${personalityToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        isDanger={true}
      />
    </>
  );

  return createPortal(modalContent, document.body);
};

// Add model helper functions
const getModelFamily = (id: string): string => {
  const families = [
    'llama', 'deepseek', 'qwen', 'codestral', 'gemma', 
    'mistral', 'codellama', 'phi', 'mixtral', 'stable'
  ];
  const match = families.find(family => id.toLowerCase().includes(family));
  return match || 'other';
};

const getModelSize = (id: string): number => {
  const sizeMatch = id.match(/(\d+)b/i);
  return sizeMatch ? parseInt(sizeMatch[1]) : 0;
};

export default SettingsPanel; 
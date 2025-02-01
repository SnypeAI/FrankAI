import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wand2, Volume2, Settings2 } from 'lucide-react';
import { motion } from 'framer-motion';

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
}) => {
  const [activeTab, setActiveTab] = useState('llm');
  const [formInputs, setFormInputs] = useState({
    llm_api_endpoint: settings.llm_api_endpoint,
    llm_model: settings.llm_model,
    llm_temperature: settings.llm_temperature,
    llm_max_tokens: settings.llm_max_tokens,
    elevenlabs_api_key: settings.elevenlabs_api_key || '',
    elevenlabs_voice_id: settings.elevenlabs_voice_id || ''
  });

  const [filters, setFilters] = useState<ModelFilters>({
    showUncensored: false,
    modelFamily: '',
    sizeRange: '',
    sortBy: 'name',
    sortDirection: 'asc'
  });

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
    { id: 'system', label: 'System', icon: Settings2 }
  ];

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
                className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all cursor-pointer"
                onClick={() => {
                  onUpdateSetting('llm_api_endpoint', config.endpoint);
                  onUpdateSetting('llm_model', config.model);
                  onUpdateSetting('llm_temperature', config.temperature);
                  onUpdateSetting('llm_max_tokens', config.max_tokens);
                }}
              >
                <h4 className="text-sm font-medium text-white/90 mb-1">{config.name}</h4>
                <p className="text-xs text-white/50">Model: {config.model}</p>
                <p className="text-xs text-white/50">Temperature: {config.temperature}</p>
              </motion.div>
            ))}
            {savedConfigs.length === 0 && (
              <p className="text-sm text-white/50 italic">No saved configurations</p>
            )}
          </div>
        </div>

        {/* Save Config Section - Now at the bottom */}
        <div className="p-4 border-t border-white/5 bg-black/20">
          <h4 className="text-xs font-medium text-white/70 mb-2">Save Current Config</h4>
          <SaveConfigForm
            onSave={onSaveConfig}
            isSaving={isSavingConfig}
            isTesting={isTestingConfig}
          />
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
                  onClick={() => onRemoveSetting(key)}
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
                      onBlur={() => onUpdateSetting('llm_api_endpoint', formInputs.llm_api_endpoint)}
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
                  <input
                    type="text"
                    value={formInputs.elevenlabs_voice_id}
                    onChange={(e) => handleInputChange('elevenlabs_voice_id', e.target.value)}
                    onBlur={() => onUpdateSetting('elevenlabs_voice_id', formInputs.elevenlabs_voice_id)}
                    className="w-full p-2 bg-black/20 border border-white/10 rounded-lg text-white/90 text-sm"
                    placeholder="Enter voice ID"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'system' && (
            <div className="space-y-6">
              {/* System Settings */}
              <div className="space-y-4">
                <p className="text-sm text-white/50">System settings coming soon...</p>
              </div>
            </div>
          )}
        </div>
      </div>
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
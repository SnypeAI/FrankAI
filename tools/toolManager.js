import { WeatherTool } from './weather/weatherTool.js';
import { GoogleSearchTool } from './search/googleSearchTool.js';

export class ToolManager {
    constructor(db) {
        this.db = db;
        this.tools = new Map();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        const configs = await this.db.getToolConfigs();
        
        // Initialize Weather Tool
        if (configs.weather?.openweather_api_key && configs.weather?.is_enabled) {
            this.tools.set('get_weather', new WeatherTool(configs.weather.openweather_api_key));
        }

        // Initialize Google Search Tool
        if (configs.google_search?.api_key && 
            configs.google_search?.search_engine_id && 
            configs.google_search?.is_enabled) {
            this.tools.set('google_search', new GoogleSearchTool(
                configs.google_search.api_key,
                configs.google_search.search_engine_id
            ));
        }

        this.initialized = true;
    }

    getAvailableTools() {
        return Array.from(this.tools.values()).map(tool => tool.getSchema());
    }

    async executeTool(toolName, params) {
        const tool = this.tools.get(toolName);
        if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
        }

        return await tool.execute(params);
    }

    async updateToolConfig(toolName, configKey, configValue) {
        await this.db.updateToolConfig(toolName, configKey, configValue);
        // Re-initialize tools with new config
        this.initialized = false;
        await this.initialize();
    }

    async setToolEnabled(toolName, isEnabled) {
        await this.db.setToolEnabled(toolName, isEnabled);
        // Re-initialize tools with new enabled state
        this.initialized = false;
        await this.initialize();
    }
} 
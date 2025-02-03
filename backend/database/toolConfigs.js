// Tool configuration methods to be mixed into Database class
export const toolConfigMethods = {
    async getToolConfigs() {
        const rows = await this.all('SELECT * FROM tool_configs');
        const configs = {};
        rows.forEach(row => {
            if (!configs[row.tool_name]) {
                configs[row.tool_name] = {
                    is_enabled: Boolean(row.is_enabled)
                };
            }
            if (row.config_key === 'is_enabled') {
                configs[row.tool_name].is_enabled = Boolean(row.is_enabled);
            } else {
                configs[row.tool_name][row.config_key] = row.config_value;
            }
        });
        return configs;
    },

    async updateToolConfig(toolName, configKey, configValue) {
        const query = `
            INSERT INTO tool_configs (tool_name, config_key, config_value, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(tool_name, config_key)
            DO UPDATE SET 
                config_value = excluded.config_value,
                updated_at = excluded.updated_at
        `;
        return this.run(query, [toolName, configKey, configValue]);
    },

    async setToolEnabled(toolName, isEnabled) {
        const query = `
            UPDATE tool_configs 
            SET is_enabled = ?, updated_at = datetime('now')
            WHERE tool_name = ?
        `;
        return this.run(query, [isEnabled ? 1 : 0, toolName]);
    },

    async deleteToolConfig(toolName, configKey) {
        return this.run(
            'DELETE FROM tool_configs WHERE tool_name = ? AND config_key = ?',
            [toolName, configKey]
        );
    }
}; 
export class Tool {
    constructor(name, description, parameters) {
        this.name = name;
        this.description = description;
        this.parameters = parameters;
    }

    async execute(params) {
        throw new Error('Tool.execute() must be implemented by subclass');
    }

    getSchema() {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: this.parameters
            }
        };
    }

    static validateParams(params, schema) {
        // Basic parameter validation
        const required = schema.required || [];
        const missing = required.filter(param => !(param in params));
        
        if (missing.length > 0) {
            throw new Error(`Missing required parameters: ${missing.join(', ')}`);
        }

        return true;
    }
} 
import { Tool } from '../base.js';

const PARAMETERS = {
    type: 'object',
    properties: {
        query: {
            type: 'string',
            description: 'The search query'
        },
        num_results: {
            type: 'integer',
            description: 'Number of results to return (max 10)',
            default: 5
        }
    },
    required: ['query']
};

export class GoogleSearchTool extends Tool {
    constructor(apiKey, searchEngineId) {
        super(
            'google_search',
            'Search the web using Google Custom Search API',
            PARAMETERS
        );
        this.apiKey = apiKey;
        this.searchEngineId = searchEngineId;
    }

    async execute({ query, num_results = 5 }) {
        Tool.validateParams({ query }, PARAMETERS);

        if (!this.apiKey || !this.searchEngineId) {
            throw new Error('Google Search API not properly configured');
        }

        try {
            const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
            searchUrl.searchParams.append('key', this.apiKey);
            searchUrl.searchParams.append('cx', this.searchEngineId);
            searchUrl.searchParams.append('q', query);
            searchUrl.searchParams.append('num', Math.min(num_results, 10));

            const response = await fetch(searchUrl);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || 'Failed to perform search');
            }

            return data.items?.map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet
            })) || [];
        } catch (error) {
            throw new Error(`Google Search API error: ${error.message}`);
        }
    }
} 
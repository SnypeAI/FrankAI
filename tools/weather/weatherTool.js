import { Tool } from '../base.js';

const PARAMETERS = {
    type: 'object',
    properties: {
        location: {
            type: 'string',
            description: 'The city name or location to get weather for'
        }
    },
    required: ['location']
};

export class WeatherTool extends Tool {
    constructor(apiKey) {
        super(
            'get_weather',
            'Get the current weather for a location',
            PARAMETERS
        );
        this.apiKey = apiKey;
    }

    async execute({ location }) {
        Tool.validateParams({ location }, PARAMETERS);

        if (!this.apiKey) {
            throw new Error('OpenWeather API key not configured');
        }

        try {
            // First get coordinates
            const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${this.apiKey}`;
            const geoResponse = await fetch(geoUrl);
            const geoData = await geoResponse.json();

            if (!geoData || geoData.length === 0) {
                throw new Error(`Location not found: ${location}`);
            }

            const { lat, lon } = geoData[0];

            // Then get weather
            const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${this.apiKey}&units=metric`;
            const weatherResponse = await fetch(weatherUrl);
            const weatherData = await weatherResponse.json();

            if (weatherData.cod !== 200) {
                throw new Error(weatherData.message || 'Failed to fetch weather data');
            }

            return {
                temperature: weatherData.main.temp,
                feels_like: weatherData.main.feels_like,
                humidity: weatherData.main.humidity,
                description: weatherData.weather[0].description,
                wind_speed: weatherData.wind.speed
            };
        } catch (error) {
            throw new Error(`Weather API error: ${error.message}`);
        }
    }
} 
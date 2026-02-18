import { ToolDefinition, ToolContext } from '../standard';

/**
 * Weather Query Tool - Uses OpenWeatherMap API
 *
 * Provides current weather and forecast information for any location
 */
export const checkWeatherTool: ToolDefinition = {
    name: 'check_weather',
    description: 'Check current weather or forecast for a location. Use when user asks about weather, temperature, or forecast.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            location: {
                type: 'string',
                description: 'City name or coordinates (e.g., "Beijing", "London", "40.7128,-74.0060")',
            },
            forecast_days: {
                type: 'integer',
                description: 'Number of forecast days (0 for current weather, 1-5 for forecast)',
                default: 0,
                minimum: 0,
                maximum: 5,
            },
            units: {
                type: 'string',
                enum: ['metric', 'imperial'],
                description: 'Temperature units (metric=Celsius, imperial=Fahrenheit)',
                default: 'metric',
            },
        },
        required: ['location'],
    },
    handler: async (args: {
        location: string;
        forecast_days?: number;
        units?: string;
    }) => {
        const { location, forecast_days = 0, units = 'metric' } = args;
        const apiKey = process.env.OPENWEATHER_API_KEY;

        if (!apiKey) {
            return {
                success: false,
                error: 'OpenWeatherMap API key not configured. Set OPENWEATHER_API_KEY environment variable.',
                help_url: 'https://openweathermap.org/api',
                instructions: [
                    '1. Visit https://openweathermap.org/api',
                    '2. Sign up for a free API key',
                    '3. Set OPENWEATHER_API_KEY environment variable',
                ],
            };
        }

        try {
            const endpoint =
                forecast_days > 0
                    ? `https://api.openweathermap.org/data/2.5/forecast`
                    : `https://api.openweathermap.org/data/2.5/weather`;

            const params = new URLSearchParams({
                q: location,
                appid: apiKey,
                units,
            });

            if (forecast_days > 0) {
                params.set('cnt', String(forecast_days * 8)); // API returns data every 3 hours
            }

            console.error(`[Weather] Fetching ${forecast_days === 0 ? 'current' : 'forecast'} weather for: ${location}`);

            const response = await fetch(`${endpoint}?${params}`);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as any;
                return {
                    success: false,
                    error: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
                    location,
                    suggestion: location.includes(',')
                        ? 'Try using just the city name'
                        : 'Try adding country code (e.g., "Beijing,CN")',
                };
            }

            const data = await response.json() as any;

            if (forecast_days === 0) {
                // Current weather
                console.error(`[Weather] Current weather for ${data.name}: ${data.weather[0].description}, ${Math.round(data.main.temp)}°${units === 'metric' ? 'C' : 'F'}`);

                return {
                    success: true,
                    location: data.name,
                    country: data.sys.country,
                    current: {
                        temperature: Math.round(data.main.temp),
                        feels_like: Math.round(data.main.feels_like),
                        humidity: data.main.humidity,
                        pressure: data.main.pressure,
                        description: data.weather[0].description,
                        main: data.weather[0].main,
                        icon: data.weather[0].icon,
                        wind_speed: Math.round(data.wind.speed * 10) / 10,
                        wind_direction: data.wind.deg,
                        clouds: data.clouds.all,
                        visibility: data.visibility,
                        sunrise: new Date(data.sys.sunrise * 1000).toLocaleTimeString(),
                        sunset: new Date(data.sys.sunset * 1000).toLocaleTimeString(),
                    },
                    units: units === 'metric' ? '°C' : '°F',
                    timestamp: new Date(data.dt * 1000).toISOString(),
                };
            } else {
                // Weather forecast
                const dailyForecast = data.list
                    .filter((_: any, i: number) => i % 8 === 0) // Take first data point of each day
                    .slice(0, forecast_days)
                    .map((item: any) => ({
                        date: new Date(item.dt * 1000).toLocaleDateString(),
                        temperature: {
                            high: Math.round(item.main.temp_max),
                            low: Math.round(item.main.temp_min),
                            average: Math.round(item.main.temp),
                        },
                        description: item.weather[0].description,
                        main: item.weather[0].main,
                        humidity: item.main.humidity,
                        wind_speed: Math.round(item.wind.speed * 10) / 10,
                        clouds: item.clouds.all,
                        rain: item.rain ? item.rain['3h'] : 0,
                    }));

                console.error(`[Weather] ${forecast_days}-day forecast for ${data.city.name}`);

                return {
                    success: true,
                    location: data.city.name,
                    country: data.city.country,
                    forecast: dailyForecast,
                    units: units === 'metric' ? '°C' : '°F',
                };
            }
        } catch (error) {
            console.error('[Weather] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                location,
                suggestion: 'Check your internet connection and API key',
            };
        }
    },
};

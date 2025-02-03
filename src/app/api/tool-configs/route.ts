import { NextResponse } from 'next/server';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function GET() {
  try {
    // Open database connection
    const db = await open({
      filename: 'database.db',
      driver: sqlite3.Database
    });

    // Load all tool configs from database
    const configs = await db.all('SELECT tool, key, value FROM tool_configs');

    // Transform the flat config list into a nested structure
    const toolConfigs = configs.reduce((acc: Record<string, Record<string, any>>, config) => {
      if (!acc[config.tool]) {
        acc[config.tool] = {};
      }
      
      // Convert 'true'/'false' strings to booleans for is_enabled
      const value = config.key === 'is_enabled' ? config.value === 'true' : config.value;
      acc[config.tool][config.key] = value;
      return acc;
    }, {});

    // Ensure default structure for required tools
    const defaultConfigs = {
      elevenlabs_tts: {
        is_enabled: false,
        api_key: '',
        voice_id: '',
        model_id: '',
        ...toolConfigs.elevenlabs_tts
      },
      whisper: {
        is_enabled: false,
        model: 'base',
        ...toolConfigs.whisper
      },
      llm: {
        is_enabled: true,
        model: '',
        temperature: 0.7,
        max_tokens: 1000,
        ...toolConfigs.llm
      }
    };

    await db.close();
    return NextResponse.json(defaultConfigs);
  } catch (error) {
    console.error('Error fetching tool configs:', error);
    return NextResponse.json({ error: 'Failed to fetch tool configs' }, { status: 500 });
  }
} 
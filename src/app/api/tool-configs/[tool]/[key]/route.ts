import { NextRequest } from 'next/server';
import db from '../../../../../../backend/database/db.js';

export async function POST(
  request: NextRequest,
  { params }: { params: { tool: string; key: string } }
) {
  try {
    const tool = params.tool;
    const key = params.key;
    const { value } = await request.json();

    // Convert boolean values to strings for storage
    const stringValue = typeof value === 'boolean' ? value.toString() : value;

    if (key === 'is_enabled') {
      await db.setToolEnabled(tool, value === 'true' || value === true);
    } else {
      await db.updateToolConfig(tool, key, stringValue);
    }

    const toolConfigs = await db.getToolConfigs();
    return Response.json(toolConfigs);
  } catch (error) {
    console.error('Error updating tool config:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
} 
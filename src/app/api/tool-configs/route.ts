import db from '../../../../backend/database/db.js';

export async function GET() {
  try {
    const toolConfigs = await db.getToolConfigs();
    return Response.json(toolConfigs);
  } catch (error: any) {
    console.error('Error fetching tool configs:', error);
    return new Response(JSON.stringify({ error: error.message || 'Failed to fetch tool configs' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
} 
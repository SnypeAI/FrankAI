import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { tool: string } }
) {
  try {
    const tool = await Promise.resolve(params.tool);
    const { enabled } = await request.json();

    // For now, we'll just return success. In a real app, this would be saved to a database
    return NextResponse.json({
      tool,
      is_enabled: enabled
    });
  } catch (error) {
    console.error('Error updating tool enabled state:', error);
    return NextResponse.json(
      { error: 'Failed to update tool enabled state' },
      { status: 500 }
    );
  }
} 
import { NextRequest, NextResponse } from 'next/server';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function POST(
  request: NextRequest,
  { params }: { params: { tool: string; key: string } }
) {
  try {
    const { tool, key } = params;
    const { value } = await request.json();

    // Convert boolean values to strings for storage
    const stringValue = typeof value === 'boolean' ? value.toString() : value;

    // Open database connection
    const db = await open({
      filename: 'database.db',
      driver: sqlite3.Database
    });

    // Update or insert the tool config
    await db.run(`
      INSERT INTO tool_configs (tool, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(tool, key)
      DO UPDATE SET value = excluded.value
    `, [tool, key, stringValue]);

    await db.close();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating tool config:', error);
    return NextResponse.json({ error: 'Failed to update tool config' }, { status: 500 });
  }
} 
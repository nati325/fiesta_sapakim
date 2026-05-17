import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const statesFile = path.join(process.cwd(), 'supplier_states.json');

export async function GET() {
  try {
    if (!fs.existsSync(statesFile)) {
      return NextResponse.json({});
    }
    const data = fs.readFileSync(statesFile, 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch (error) {
    return NextResponse.json({});
  }
}

export async function POST(req) {
  try {
    const payload = await req.json();
    let currentStates = {};
    if (fs.existsSync(statesFile)) {
        try {
            currentStates = JSON.parse(fs.readFileSync(statesFile, 'utf-8'));
        } catch(e) {}
    }
    
    // Merge the new state for the specific phone number
    if (payload.phone !== undefined && payload.state) {
        currentStates[payload.phone] = { ...currentStates[payload.phone], ...payload.state };
    }

    fs.writeFileSync(statesFile, JSON.stringify(currentStates, null, 2), 'utf-8');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';

export async function GET() {
  try {
    const { isAdmin: admin } = await isAdmin();
    return NextResponse.json({ isAdmin: admin });
  } catch (error) {
    console.error('Error checking admin status:', error);
    return NextResponse.json({ isAdmin: false });
  }
}

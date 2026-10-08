import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { rotateDirectoryKey } from '@/lib/db';

// POST /api/blog-directory/key — replace the signed-in author's secret directory
// link; the old one stops working at once. Not a public route: middleware holds
// it behind sign-in, and it only ever changes the caller's own key.
export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    return NextResponse.json({ key: await rotateDirectoryKey(userId) });
  } catch (error) {
    console.error('[BLOG-DIRECTORY-KEY] Error:', error);
    return NextResponse.json({ error: 'Could not make a new link' }, { status: 500 });
  }
}

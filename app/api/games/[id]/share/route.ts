import { NextRequest, NextResponse } from 'next/server';
import { getGame, publishBlog, unpublishBlog } from '@/lib/db';
import { clearBlogDirectoryCache } from '@/lib/blog-directory-server';

// POST /api/games/[id]/share — publish this game's blog so anyone with the
// link can read it, and list it in the public directory at /blog
// (authenticated; only the game's owner can publish).
// DELETE — un-share it again, which takes it out of the directory too.
// Either way the directory is read afresh on its next visit.
//
// This route is intentionally NOT in middleware's public list: the caller must
// be signed in, and getGame() (session-scoped) ensures they own the game.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gameId } = await params;

    const game = await getGame(gameId);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    await publishBlog(gameId);
    clearBlogDirectoryCache();
    return NextResponse.json({ shared: true });
  } catch (error) {
    console.error('[BLOG-SHARE] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to share blog post' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gameId } = await params;
    await unpublishBlog(gameId);
    clearBlogDirectoryCache();
    return NextResponse.json({ shared: false });
  } catch (error) {
    console.error('[BLOG-SHARE] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to un-share blog post' },
      { status: 500 }
    );
  }
}

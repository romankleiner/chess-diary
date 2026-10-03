import { NextRequest, NextResponse } from 'next/server';
import { getModelCatalog } from '@/lib/model-catalog-server';

// GET /api/models            - the list of Claude models available for AI analysis
// GET /api/models?refresh=1  - bypass the cache and fetch from Anthropic now
export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
  const catalog = await getModelCatalog({ forceRefresh });
  return NextResponse.json(catalog);
}

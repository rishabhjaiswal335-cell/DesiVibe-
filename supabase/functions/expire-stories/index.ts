// Supabase Edge Function: Scheduled 24-hour Story Expiration & Storage Cleanup
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const nowIso = new Date().toISOString();
  const { data: expiredStories, error } = await supabase
    .from('stories')
    .select('id, media_url')
    .lte('expires_at', nowIso);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const pathsToDelete: string[] = [];
  const idsToDelete: string[] = [];

  for (const story of expiredStories ?? []) {
    idsToDelete.push(story.id);
    const marker = '/storage/v1/object/public/stories/';
    if (story.media_url?.includes(marker)) {
      pathsToDelete.push(story.media_url.split(marker)[1]);
    }
  }

  if (pathsToDelete.length > 0) {
    await supabase.storage.from('stories').remove(pathsToDelete);
  }

  if (idsToDelete.length > 0) {
    await supabase.from('stories').delete().in('id', idsToDelete);
  }

  return new Response(
    JSON.stringify({ cleanedStories: idsToDelete.length, removedObjects: pathsToDelete.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});

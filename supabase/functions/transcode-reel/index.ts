// Supabase Edge Function: Optimize / Transcode Uploaded VibeReel Metadata & Webhook Dispatch
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface TranscodeRequest {
  postId?: string;
  bucket?: string;
  objectPath?: string;
  originalSize?: number;
  compressedSize?: number;
  mimeType?: string;
  durationSec?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header.' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    // Allow authenticated user or verified service-role call
    if ((authErr || !user) && !authHeader.includes(serviceRoleKey)) {
      return new Response(JSON.stringify({ error: 'Unauthorized transcode request.' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    const body = (await req.json()) as TranscodeRequest;
    const bucket = body.bucket || 'reels';
    const objectPath = String(body.objectPath || '').trim();
    const originalSize = Number(body.originalSize || 0);
    const compressedSize = Number(body.compressedSize || originalSize || 0);
    const durationSec = Number(body.durationSec || 0);

    if (!objectPath) {
      return new Response(JSON.stringify({ error: 'objectPath is required.' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey || supabaseAnonKey);

    // Build public delivery URL for Supabase Storage when stored there
    let deliveryUrl = objectPath;
    if (!/^https?:\/\//i.test(objectPath) && !objectPath.startsWith('/')) {
      const { data: publicData } = adminClient.storage.from(bucket).getPublicUrl(objectPath);
      deliveryUrl = publicData?.publicUrl || objectPath;
    }

    // Forward to external cloud transcoder (Mux / Cloudflare Stream / FFmpeg worker) if configured
    const webhookUrl = Deno.env.get('TRANSCODE_WEBHOOK_URL');
    let remoteJobId: string | null = null;
    if (webhookUrl) {
      try {
        const hookRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(Deno.env.get('TRANSCODE_WEBHOOK_SECRET')
              ? { 'x-transcode-secret': Deno.env.get('TRANSCODE_WEBHOOK_SECRET')! }
              : {}),
          },
          body: JSON.stringify({
            postId: body.postId || null,
            bucket,
            objectPath,
            deliveryUrl,
            targetPreset: '720p_faststart_h264',
            maxBitrateKbps: 1400,
            durationSec,
          }),
        });
        if (hookRes.ok) {
          const hookJson = await hookRes.json().catch(() => ({}));
          remoteJobId = hookJson?.jobId || hookJson?.id || 'dispatched';
        }
      } catch {
        // Non-fatal: client-compressed stream remains immediately playable
      }
    }

    const savedBytes = Math.max(0, originalSize - compressedSize);
    const compressionRatio =
      originalSize > 0 ? Number((savedBytes / originalSize).toFixed(3)) : 0;

    return new Response(
      JSON.stringify({
        optimized: true,
        bucket,
        objectPath,
        deliveryUrl,
        preset: '720p_1.35mbps_faststart',
        originalSize,
        compressedSize,
        savedBytes,
        compressionRatio,
        remoteJobId,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Transcode failed.' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});

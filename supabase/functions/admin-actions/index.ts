// Supabase Edge Function: Protected Admin & Super Admin Actions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPER_ADMIN_EMAIL = 'rishabhjaiswal335@gmail.com';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });

  const { data: actor } = await supabaseAdmin
    .from('profiles')
    .select('id, role, account_status')
    .eq('id', user.id)
    .single();

  if (!actor || !['admin', 'super_admin'].includes(actor.role) || actor.account_status !== 'active') {
    return new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), { status: 403 });
  }

  const { action, targetUserId } = await req.json();
  const { data: target } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role')
    .eq('id', targetUserId)
    .single();

  if (!target) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });

  // Protect Super Admin from ban/suspend/demote
  if (target.role === 'super_admin' || target.email?.toLowerCase() === SUPER_ADMIN_EMAIL) {
    if (['ban', 'suspend', 'demote'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Super Admin cannot be banned or demoted' }), { status: 403 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (action === 'verify') updates.is_verified = true;
  if (action === 'unverify') updates.is_verified = false;
  if (action === 'ban') updates.account_status = 'banned';
  if (action === 'suspend') updates.account_status = 'suspended';
  if (action === 'activate') updates.account_status = 'active';
  if (action === 'promote' && actor.role === 'super_admin') updates.role = 'admin';
  if (action === 'demote' && actor.role === 'super_admin') updates.role = 'user';

  await supabaseAdmin.from('profiles').update(updates).eq('id', targetUserId);
  await supabaseAdmin.from('admin_audit_logs').insert({
    admin_id: actor.id,
    action: `user:${action}`,
    target_type: 'user',
    target_id: targetUserId,
  });

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});

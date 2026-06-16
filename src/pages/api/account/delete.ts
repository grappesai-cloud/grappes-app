// ── GDPR Account Deletion ────────────────────────────────────────────────────
// Deletes the authenticated user's account and all associated data.
// Art. 17 GDPR — Right to erasure.

import type { APIRoute } from 'astro';
import { del as blobDel } from '@lib/r2-blob';
import { createAdminClient } from '../../../lib/supabase';
import { json } from '../../../lib/api-utils';
import { checkRateLimit } from '../../../lib/rate-limit';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 1 deletion/day per user
  if (!checkRateLimit(`account:delete:${user.id}`, 1, 86_400_000)) {
    return json({ error: 'Account deletion already requested. Try again tomorrow.' }, 429);
  }

  const client = createAdminClient();

  try {
    // 1. Archive all projects (preserves generated sites briefly for Vercel cleanup)
    await client
      .from('projects')
      .update({ status: 'archived', billing_status: 'expired', updated_at: new Date().toISOString() })
      .eq('user_id', user.id);

    // 2. Delete user-linked data (cascading from user_id foreign keys)
    // Order matters: children before parents
    const projectIds = await client
      .from('projects')
      .select('id')
      .eq('user_id', user.id);

    if (projectIds.data?.length) {
      const ids = projectIds.data.map(p => p.id);

      // Delete project-linked data
      for (const pid of ids) {
        await client.from('generated_files').delete().eq('project_id', pid);
        await client.from('conversations').delete().eq('project_id', pid);
        await client.from('briefs').delete().eq('project_id', pid);
        await client.from('deployments').delete().eq('project_id', pid);
        await client.from('costs').delete().eq('project_id', pid);
        await client.from('pageviews').delete().eq('project_id', pid);

        // Delete assets from blob storage + DB
        const { data: assets } = await client
          .from('assets')
          .select('id, public_url, metadata')
          .eq('project_id', pid);

        if (assets?.length) {
          const urls: string[] = [];
          for (const asset of assets) {
            if (asset.public_url) urls.push(asset.public_url);
            const variantUrls = (asset.metadata as any)?.variants as Record<string, string> | undefined;
            if (variantUrls) urls.push(...Object.values(variantUrls));
          }
          if (urls.length > 0) {
            try { await blobDel(urls); } catch (e) { console.warn('[account/delete] blob del failed:', e); }
          }
          await client.from('assets').delete().eq('project_id', pid);
        }
      }

      // Delete projects themselves
      await client.from('projects').delete().eq('user_id', user.id);
    }

    // 3. Delete the auth-managed user row (cascades via FK to public.users)
    await client.from('user').delete().eq('id', user.id);
    // Belt-and-braces: explicitly drop the public.users mirror row too
    await client.from('users').delete().eq('id', user.id);

    return json({ ok: true, message: 'Account and all associated data deleted.' });
  } catch (e) {
    console.error('[account/delete] Error:', e);
    return json({ error: 'Account deletion failed. Contact support.' }, 500);
  }
};

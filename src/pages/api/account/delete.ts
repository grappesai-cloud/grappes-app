// ── GDPR Account Deletion ────────────────────────────────────────────────────
// Deletes the authenticated user's account and all associated data.
// Art. 17 GDPR — Right to erasure.

import type { APIRoute } from 'astro';
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

        // Delete assets from storage + DB
        const { data: assets } = await client
          .from('assets')
          .select('id, storage_path, metadata')
          .eq('project_id', pid);

        if (assets?.length) {
          const storagePaths: string[] = [];
          for (const asset of assets) {
            storagePaths.push(asset.storage_path);
            const variantPaths = (asset.metadata as any)?.variantPaths as string[] | undefined;
            if (variantPaths?.length) storagePaths.push(...variantPaths);
          }
          if (storagePaths.length > 0) {
            await client.storage.from('assets').remove(storagePaths);
          }
          await client.from('assets').delete().eq('project_id', pid);
        }
      }

      // Delete projects themselves
      await client.from('projects').delete().eq('user_id', user.id);
    }

    // 3. Delete referral data
    await client.from('referrals').delete().eq('referrer_id', user.id);
    await client.from('referrals').delete().eq('referred_id', user.id);
    await client.from('referral_payouts').delete().eq('referrer_id', user.id);

    // 4. Delete user record
    await client.from('users').delete().eq('id', user.id);

    // 5. Delete auth user (Supabase Auth)
    await client.auth.admin.deleteUser(user.id);

    return json({ ok: true, message: 'Account and all associated data deleted.' });
  } catch (e) {
    console.error('[account/delete] Error:', e);
    return json({ error: 'Account deletion failed. Contact support.' }, 500);
  }
};

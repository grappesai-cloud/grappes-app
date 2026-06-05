import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { socialZernioProfiles } from '../../db/schema/social';
import * as zernio from './zernio';

// Returns the cached Zernio profileId for this user, creating one on first
// call. profileId is a plain Mongo _id (not a secret) so it's stored clear.
export async function getOrCreateProfile(
  userId: string,
  name: string
): Promise<{ profileId: string; createdNow: boolean }> {
  const [existing] = await db
    .select()
    .from(socialZernioProfiles)
    .where(eq(socialZernioProfiles.userId, userId))
    .limit(1);

  if (existing) {
    return { profileId: existing.profileId, createdNow: false };
  }

  const created = await zernio.createProfile(name);
  await db.insert(socialZernioProfiles).values({ userId, profileId: created._id });
  return { profileId: created._id, createdNow: true };
}

export async function getProfile(userId: string): Promise<{ profileId: string } | null> {
  const [row] = await db
    .select()
    .from(socialZernioProfiles)
    .where(eq(socialZernioProfiles.userId, userId))
    .limit(1);
  return row ? { profileId: row.profileId } : null;
}

// Remove the Zernio-side profile and the local row. Leaves socialConnections /
// metrics intact so historic data stays viewable.
export async function deleteProfile(userId: string): Promise<void> {
  const profile = await getProfile(userId);
  if (profile) {
    await zernio.deleteProfile(profile.profileId);
  }
  await db.delete(socialZernioProfiles).where(eq(socialZernioProfiles.userId, userId));
}

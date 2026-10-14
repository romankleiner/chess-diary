/**
 * Who the signed-in user is, as far as the app's data goes. Server only.
 *
 * Data in Redis is keyed by a Clerk user id (chess-diary:{id}:..., and the id is
 * stored as the owner of shared blogs, of directory keys and as the admin). An
 * account can have a different Clerk id from the one its data is kept under: the
 * author's moved from Clerk's Development instance to Production, which gave it a
 * new id, and its data stayed under the old one rather than being migrated. Local
 * development still signs in through the Development instance, as the old id, so
 * both reach the same data.
 *
 * So the app identifies the signed-in user with currentUserId(), never with
 * auth().userId directly, wherever the id reaches the data or is compared with an
 * id the data holds. (Checking only whether someone is signed in can use auth().)
 */
import { auth } from '@clerk/nextjs/server';

/** Clerk id → the id its account's data is kept under. */
const DATA_ID_OF: ReadonlyMap<string, string> = new Map([
  // The author: Production instance → the Development instance id the data was created under
  ['user_3KgYiYzMxX8zUjN4dBbv55hfT1T', 'user_395GdJ9fMuBbALA4mvYzpEUQrNI'],
]);

/** The id a Clerk user's data is kept under: their own, unless their account was carried over. */
export function dataUserId(clerkUserId: string | null | undefined): string | null {
  if (!clerkUserId) return null;
  return DATA_ID_OF.get(clerkUserId) ?? clerkUserId;
}

/** The signed-in user's data id (see dataUserId), or null when nobody is signed in. */
export async function currentUserId(): Promise<string | null> {
  const { userId } = await auth();
  return dataUserId(userId);
}

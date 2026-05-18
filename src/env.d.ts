/// <reference types="astro/client" />
import type { auth } from './lib/auth';
import type { SupabaseLikeClient } from './lib/supabase';

type Session = typeof auth.$Infer.Session;
type AuthUser = Session['user'];

declare global {
  namespace App {
    interface Locals {
      user: AuthUser | null;
      session: Session['session'] | null;
      /** Supabase-compat shim — temporary, callsites are migrating away. */
      supabase: SupabaseLikeClient;
    }
  }
}

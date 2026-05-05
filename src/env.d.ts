/// <reference types="astro/client" />
import type { auth } from './lib/auth';

type Session = typeof auth.$Infer.Session;
type AuthUser = Session['user'];

declare global {
  namespace App {
    interface Locals {
      user: AuthUser | null;
      session: Session['session'] | null;
    }
  }
}

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { e } from '../lib/env';

const client = postgres(e('DATABASE_URL'), {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client);
export { client as sql };

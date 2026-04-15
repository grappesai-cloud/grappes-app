-- In-app support chat between users and the Grappes admin.
-- Each user has at most one open thread at a time (enforced at app level).

CREATE TABLE IF NOT EXISTS support_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'open',   -- open | closed
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unread_for_user   BOOLEAN NOT NULL DEFAULT FALSE,
  unread_for_admin  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_threads_user_status_idx
  ON support_threads(user_id, status);
CREATE INDEX IF NOT EXISTS support_threads_admin_queue_idx
  ON support_threads(status, unread_for_admin DESC, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL,                     -- 'user' | 'admin'
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_messages_thread_idx
  ON support_messages(thread_id, created_at);

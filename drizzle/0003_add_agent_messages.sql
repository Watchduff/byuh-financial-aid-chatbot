ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS assigned_agent_name text;

CREATE TABLE IF NOT EXISTS agent_messages (
  id text PRIMARY KEY,
  support_request_id text NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  content text NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

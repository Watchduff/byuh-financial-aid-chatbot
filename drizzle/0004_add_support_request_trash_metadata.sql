ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS deleted_from_status text;
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS deleted_at timestamp;

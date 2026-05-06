ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS response_mode text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS response_confidence text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS response_confidence_score integer;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS response_sources text;

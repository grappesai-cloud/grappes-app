-- Track sign-up IP on referrals for anti-gaming (max 3 referrals per IP per 24h)
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS signup_ip text;
CREATE INDEX IF NOT EXISTS idx_referrals_signup_ip ON referrals (signup_ip, created_at DESC);

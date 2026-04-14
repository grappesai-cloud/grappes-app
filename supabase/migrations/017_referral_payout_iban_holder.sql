-- Store IBAN holder name alongside IBAN for payouts.
ALTER TABLE referral_payouts
  ADD COLUMN IF NOT EXISTS iban_holder TEXT;

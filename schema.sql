
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT CHECK (platform IN ('meta','tiktok','snap')) NOT NULL,
  external_account_id TEXT NOT NULL,
  name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, external_account_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT CHECK (platform IN ('meta','tiktok','snap')) NOT NULL,
  external_lead_id TEXT NOT NULL UNIQUE,
  form_id TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  fields JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT now(),
  source_account UUID REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS leads_platform_created_idx ON leads (platform, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (email);

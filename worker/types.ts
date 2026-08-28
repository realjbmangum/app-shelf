export type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  FILES: R2Bucket;
  ASSETS: Fetcher;
};

// Set in slice 1. Never commit values: .dev.vars locally, `wrangler secret
// put` for production.
export type Secrets = {
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM?: string;
};

export type Env = Bindings & Secrets;

create extension if not exists vector;

create table if not exists research_runs (
  id uuid primary key,
  cisco_product text not null,
  target_market text not null,
  geography text,
  company_size text,
  max_results integer not null default 5,
  seed_accounts text[] not null default '{}',
  status text not null,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kb_documents (
  id uuid primary key,
  run_id uuid references research_runs(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  source_type text not null default 'uploaded_kb',
  extracted_text text not null,
  created_at timestamptz not null default now()
);

create table if not exists kb_chunks (
  id uuid primary key,
  document_id uuid references kb_documents(id) on delete cascade,
  run_id uuid references research_runs(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key,
  run_id uuid references research_runs(id) on delete cascade,
  company_name text not null,
  fit_reason text not null,
  suggested_outreach_angle text not null,
  confidence_score numeric not null,
  scores jsonb not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key,
  account_id uuid references accounts(id) on delete cascade,
  role_type text not null,
  name text,
  title text not null,
  business_email text,
  email_verified boolean not null default false,
  profile_url text,
  company_page text,
  verification_status text not null,
  relationship_hypothesis text not null,
  citations jsonb not null default '[]'::jsonb
);

create table if not exists evidence (
  id uuid primary key,
  account_id uuid references accounts(id) on delete cascade,
  url text not null,
  title text not null,
  source_type text not null,
  source_date text,
  snippet text not null,
  retrieved_at timestamptz not null default now()
);

-- Enable pgvector extension
create extension if not exists vector;

-- Sessions table to track anonymous sessions
create table sessions (
    id uuid primary key default gen_random_uuid(),
    created_at timestamp with time zone default now(),
    last_active timestamp with time zone default now()
);

-- Documents table to store PDF metadata
create table public.documents (
  id uuid not null default gen_random_uuid (),
  session_id uuid null,
  filename text not null,
  created_at timestamp with time zone null default now(),
  page_count bigint null,
  constraint documents_pkey primary key (id),
  constraint documents_session_id_fkey foreign KEY (session_id) references sessions (id) on delete CASCADE
) TABLESPACE pg_default;


-- Document chunks table with vector storage
create table document_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid references documents(id) on delete cascade,
    content text not null,
    embedding vector(768), -- Adjust dimension based on your embedding model
    metadata jsonb,
    chunk_index integer,
    created_at timestamp with time zone default now()
);

-- Conversations table to group messages
create table conversations (
    id uuid primary key default gen_random_uuid(),
    session_id uuid references sessions(id) on delete cascade,
    created_at timestamp with time zone default now()
);

-- Messages table for chat history
create table messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid references conversations(id) on delete cascade,
    role text check (role in ('user', 'assistant')),
    content text not null,
    created_at timestamp with time zone default now()
);

-- Create indexes for better query performance
create index on document_chunks using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);
create index on documents (session_id);
create index on document_chunks (document_id);
create index on messages (conversation_id);
create index on conversations (session_id);

-- Function to search document chunks by embedding similarity
create or replace function search_document_chunks(
    query_embedding vector(768),
    similarity_threshold float,
    max_results int
)
returns table (
    id uuid,
    content text,
    similarity float
)
language plpgsql
as $$
begin
    return query
    select
        document_chunks.id,
        document_chunks.content,
        1 - (document_chunks.embedding <=> query_embedding) as similarity
    from document_chunks
    where 1 - (document_chunks.embedding <=> query_embedding) > similarity_threshold
    order by document_chunks.embedding <=> query_embedding
    limit max_results;
end;
$$;

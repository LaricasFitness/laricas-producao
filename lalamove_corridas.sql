-- Corridas da Lalamove chamadas pela Expedição (api/lalamove.mjs).
-- Uma linha por corrida: a rota do planejamento (logistica_historico), os pedidos do Bling que foram nela,
-- o preço cotado e o link de acompanhamento (vai para a Shopify como rastreio na baixa).
-- Só as funções do Vercel leem e gravam (service role): RLS ligado e sem nenhuma policy.

create table if not exists public.lalamove_corridas (
  id            uuid primary key default gen_random_uuid(),
  ambiente      text not null default 'sandbox',        -- sandbox | producao
  rota_code     text,
  rota_label    text,
  historico_id  uuid,                                    -- logistica_historico.id de onde veio a rota
  pedidos       text[] not null default '{}',            -- números dos pedidos no Bling, na ordem das paradas
  quotation_id  text,
  order_id      text,
  share_link    text,
  status        text,
  preco         numeric(10,2),
  moeda         text,
  distancia_m   integer,
  criado_por    text,
  criado_em     timestamptz not null default now()
);

create index if not exists lalamove_corridas_pedidos_idx on public.lalamove_corridas using gin (pedidos);
create index if not exists lalamove_corridas_criado_idx on public.lalamove_corridas (criado_em desc);

alter table public.lalamove_corridas enable row level security;
-- sem policy: anon/authenticated não leem nem escrevem

-- Conferência: deve voltar rowsecurity = true e nenhuma policy
select relrowsecurity as rowsecurity from pg_class where oid = 'public.lalamove_corridas'::regclass;
select policyname from pg_policies where schemaname = 'public' and tablename = 'lalamove_corridas';

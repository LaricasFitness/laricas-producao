-- Pedidos deixados para o dia seguinte na Expedição (ex.: endereço comercial na hora de chamar a Lalamove).
-- Na manhã do dia lembrar_em, a Expedição mostra o aviso no topo até a baixa do pedido (ou alguém marcar resolvido).
-- Só as funções do Vercel leem e gravam (service role): RLS ligado e sem nenhuma policy.

create table if not exists public.expedicao_adiamentos (
  id            uuid primary key default gen_random_uuid(),
  pedido        text not null,                 -- nº do pedido no Bling
  cliente       text,
  motivo        text,                          -- ex.: 'Endereço comercial (Sala 12)'
  rota          text,                          -- ex.: '03 · Centro'
  lembrar_em    date not null,                 -- dia em que o aviso aparece (horário de Brasília)
  criado_por    text,
  criado_em     timestamptz not null default now(),
  resolvido_em  timestamptz,
  resolvido_por text
);

create index if not exists expedicao_adiamentos_pendentes_idx on public.expedicao_adiamentos (lembrar_em) where resolvido_em is null;

alter table public.expedicao_adiamentos enable row level security;
-- sem policy: anon/authenticated não leem nem escrevem

-- Conferência: deve voltar rowsecurity = true e nenhuma policy
select relrowsecurity as rowsecurity from pg_class where oid = 'public.expedicao_adiamentos'::regclass;
select policyname from pg_policies where schemaname = 'public' and tablename = 'expedicao_adiamentos';

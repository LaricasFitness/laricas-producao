-- Trava de custo do Google Maps (busca de endereços da Lalamove, api/lalamove.mjs).
-- geocode_uso:   quantas consultas ao Google por dia. Passou de 250 no dia ou 8.000 no mês (o grátis é 10.000),
--                o sistema para de chamar o Google e usa só o OpenStreetMap até virar o dia/mês.
-- geocode_cache: endereço já localizado não consulta de novo (nem o Google, nem o OpenStreetMap).
-- Só as funções do Vercel leem e gravam (service role): RLS ligado e sem nenhuma policy.

create table if not exists public.geocode_uso (
  dia        date primary key,               -- horário de Brasília
  google     integer not null default 0,     -- consultas feitas ao Google nesse dia
  atualizado timestamptz not null default now()
);

create table if not exists public.geocode_cache (
  chave    text primary key,                 -- rua|número|cidade (minúsculas)
  lat      text not null,
  lng      text not null,
  fonte    text,
  criado_em timestamptz not null default now()
);

alter table public.geocode_uso enable row level security;
alter table public.geocode_cache enable row level security;
-- sem policy: anon/authenticated não leem nem escrevem

-- Soma 1 consulta ao Google no dia e devolve o total do dia e do mês (atômico, sem corrida entre chamadas)
create or replace function public.geocode_contar_google(p_dia date)
returns table (no_dia integer, no_mes integer)
language sql
security definer
set search_path = public
as $$
  with up as (
    insert into public.geocode_uso as u (dia, google) values (p_dia, 1)
    on conflict (dia) do update set google = u.google + 1, atualizado = now()
    returning u.google
  )
  select (select google from up),
         coalesce((select sum(google) from public.geocode_uso
                   where date_trunc('month', dia) = date_trunc('month', p_dia) and dia <> p_dia), 0)::integer
         + (select google from up);
$$;
revoke all on function public.geocode_contar_google(date) from public, anon, authenticated;

-- Conferência: rowsecurity = true nas duas e nenhuma policy
select relname, relrowsecurity from pg_class where relname in ('geocode_uso', 'geocode_cache');
select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('geocode_uso', 'geocode_cache');

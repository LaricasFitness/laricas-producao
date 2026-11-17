-- Fecha a tabela usuarios ao navegador (chave pública/anon do site).
-- Antes: qualquer pessoa com a chave pública (que vai dentro do site) lia e-mails e hashes de senha,
-- e podia criar ou alterar usuários. Agora o login e o cadastro passam pelas funções do Vercel
-- (/api/sessao), que usam a chave de serviço — ela ignora o RLS e continua funcionando.
--
-- APLICAR SÓ DEPOIS do deploy do commit "Controle de acesso" estar no ar (senão o login antigo
-- para de funcionar antes do novo existir).

alter table public.usuarios enable row level security;
drop policy if exists public_all on public.usuarios;
-- sem nenhuma policy: anon/authenticated não leem nem escrevem; a service role continua com acesso total

-- Conferência: deve voltar zero linhas
select policyname from pg_policies where schemaname = 'public' and tablename = 'usuarios';

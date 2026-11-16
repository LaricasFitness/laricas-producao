-- Expedição: baixa dos pedidos enviados (Bling → Atendido, Shopify → enviado e arquivado)

-- 1) Tokens de acesso das integrações (Bling). RLS ligado e SEM política: o navegador (chave anon)
--    não lê nem grava nada aqui; só a função do Vercel, com a chave service_role.
CREATE TABLE IF NOT EXISTS integracao_tokens (
  servico        text PRIMARY KEY,                  -- 'bling'
  access_token   text NOT NULL,
  refresh_token  text NOT NULL,
  expira_em      timestamptz NOT NULL,
  atualizado_em  timestamptz DEFAULT now()
);
ALTER TABLE integracao_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON integracao_tokens;

-- 2) Registro de cada pedido baixado pela expedição (o que deu certo e o que deu erro)
CREATE TABLE IF NOT EXISTS expedicao_envios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bling_id       bigint NOT NULL,
  numero         text,                               -- número do pedido no Bling
  numero_loja    text,                               -- número do pedido na loja (Shopify)
  cliente        text,
  transportadora text,
  rastreio       text,
  ok_shopify     boolean,                            -- null = não é pedido da Shopify
  ok_bling       boolean NOT NULL DEFAULT false,
  erro           text,
  operador       text,
  criado_em      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expedicao_envios_criado ON expedicao_envios (criado_em DESC);
ALTER TABLE expedicao_envios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON expedicao_envios;
CREATE POLICY public_all ON expedicao_envios FOR ALL USING (true) WITH CHECK (true);

-- Conferência: as duas com RLS; integracao_tokens sem nenhuma política (0)
SELECT c.relname, c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS politicas
  FROM pg_class c WHERE c.relname IN ('integracao_tokens', 'expedicao_envios');

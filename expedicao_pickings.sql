-- Pickings da expedição: gerados ao fechar o planejamento de produção (botão "PDF Produção")
-- com os pedidos do dia que vieram na planilha do Bling. O líder de expedição baixa o PDF em
-- Logística › Expedição › Pickings. Um picking por dia de produção (gerar de novo substitui).

CREATE TABLE IF NOT EXISTS expedicao_pickings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_producao  date NOT NULL UNIQUE,              -- dia do planejamento (Data Prevista dos pedidos)
  pedidos        jsonb NOT NULL DEFAULT '[]',       -- pedidos já com itens, envio, cidade/UF, loja e observações
  faltando       text[] NOT NULL DEFAULT '{}',      -- números da planilha que não foram achados no Bling
  gerado_por     text,
  gerado_em      timestamptz DEFAULT now(),
  baixado_por    text,
  baixado_em     timestamptz
);
CREATE INDEX IF NOT EXISTS expedicao_pickings_data ON expedicao_pickings (data_producao DESC);
ALTER TABLE expedicao_pickings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON expedicao_pickings;
CREATE POLICY public_all ON expedicao_pickings FOR ALL USING (true) WITH CHECK (true);

-- Conferência: RLS ligado e 1 política
SELECT c.relname, c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS politicas
  FROM pg_class c WHERE c.relname = 'expedicao_pickings';

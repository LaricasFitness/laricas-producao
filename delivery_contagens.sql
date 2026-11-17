-- Contagem diária do estoque do delivery da Bela Vista (Logística › Delivery BV)
-- Substitui a planilha "Laricas_Delivery.xlsx › ✅ Controle Delivery".
-- Todo fim de dia, depois do restock, o Gabriel lança por SKU:
--   geladeira   = unidades na geladeira do delivery (Bela Vista)
--   armazenagem = unidades no estoque da produção
--   validade    = validade mais antiga da armazenagem
-- Uma linha por (data, sku): lançar de novo no mesmo dia corrige a contagem.
-- demanda_cobrir e custo_unitario ficam congelados no dia da contagem, para o
-- histórico não mudar quando a previsão ou o custo mudarem.
-- Esta tabela é só controle: não debita nem credita estoque de MP/embalagem.

CREATE TABLE IF NOT EXISTS delivery_contagens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data            date NOT NULL,
  sku             text NOT NULL,                      -- embalagens.codigo do rótulo
  nome            text,                               -- nome do produto no dia
  categoria       text,
  geladeira       integer NOT NULL DEFAULT 0 CHECK (geladeira >= 0),
  armazenagem     integer NOT NULL DEFAULT 0 CHECK (armazenagem >= 0),
  validade        date,                               -- mais antiga da armazenagem
  demanda_cobrir  integer,                            -- previsão até a próxima contagem (qui = sex+sáb+dom+seg)
  custo_unitario  numeric(12,4),                      -- CMV direto do produto (cmv_historico) no dia
  registrado_por  text,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now(),
  UNIQUE (data, sku)
);
CREATE INDEX IF NOT EXISTS delivery_contagens_data ON delivery_contagens (data DESC);

ALTER TABLE delivery_contagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON delivery_contagens;
CREATE POLICY public_all ON delivery_contagens FOR ALL USING (true) WITH CHECK (true);

-- Conferência: tabela criada com RLS ligado e a política
SELECT (SELECT relrowsecurity FROM pg_class WHERE relname = 'delivery_contagens') AS rls_ligado,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'delivery_contagens') AS politicas;

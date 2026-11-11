-- Margem por canal: % de custo do produto (CMV teórico) sobre a receita bruta de cada canal.
-- Ponto de partida: 22% = custo da ficha técnica ÷ preço do site (out/26, 28 produtos);
-- Revenda (B2B) 34% = mesma ficha sobre a tabela de revenda (~35% abaixo do site).
-- Ajuste pela tela Financeiro › Margem por canal (coluna "% custo").

CREATE TABLE IF NOT EXISTS dre_cmv_canal (
  canal         text PRIMARY KEY,
  pct           numeric(5,2) NOT NULL CHECK (pct >= 0 AND pct <= 100),
  atualizado_em timestamptz DEFAULT now()
);

ALTER TABLE dre_cmv_canal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON dre_cmv_canal;
CREATE POLICY public_all ON dre_cmv_canal FOR ALL USING (true) WITH CHECK (true);

INSERT INTO dre_cmv_canal (canal, pct) VALUES
  ('iFood', 22), ('99 Food', 22), ('Keeta', 22), ('Anota.AI', 22),
  ('Site', 22), ('Clube', 22), ('Mercado Livre', 22),
  ('Revenda', 34), ('Venda Direta', 22), ('Balcão', 22), ('Ativação', 22)
ON CONFLICT (canal) DO NOTHING;

-- Conferência: 11 canais, RLS ligado
SELECT (SELECT count(*) FROM dre_cmv_canal) AS canais, relrowsecurity FROM pg_class WHERE relname = 'dre_cmv_canal';

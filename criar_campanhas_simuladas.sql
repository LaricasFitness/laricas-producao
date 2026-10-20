-- Simulação de campanhas de desconto (Custos › Simular campanha).
-- Guarda o cenário para voltar, ajustar e comparar canais. Não afeta preços,
-- estoque nem CMV — é só simulação.

CREATE TABLE IF NOT EXISTS campanhas_simuladas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  canal_id      text NOT NULL,
  dias          integer NOT NULL DEFAULT 7,       -- duração da campanha
  multiplicador numeric NOT NULL DEFAULT 1,       -- volume extra esperado (2 = dobro)
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campanha_simulada_itens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id  uuid NOT NULL REFERENCES campanhas_simuladas(id) ON DELETE CASCADE,
  sku_produto  text NOT NULL,
  desconto_pct numeric,                           -- % sobre o preço do canal
  qtd_estimada numeric,                           -- só quando digitada (senão o sistema estima)
  preco_base   numeric,                           -- só para produto sem preço cadastrado no canal
  UNIQUE (campanha_id, sku_produto)
);

ALTER TABLE campanhas_simuladas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON campanhas_simuladas FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE campanha_simulada_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON campanha_simulada_itens FOR ALL USING (true) WITH CHECK (true);

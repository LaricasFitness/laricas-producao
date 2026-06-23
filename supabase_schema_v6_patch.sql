-- Patch v6: adiciona campos de valor e cria tabela de recebimentos

-- Adiciona valor unitário em pedido_itens (para calcular custo)
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS valor_unitario numeric(10,2);

-- Tabela de recebimentos (entrada de embalagens da gráfica)
CREATE TABLE IF NOT EXISTS recebimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid REFERENCES pedidos_grafica(id) ON DELETE SET NULL,
  numero_nf text,
  data_recebimento date NOT NULL DEFAULT CURRENT_DATE,
  observacao text,
  valor_total numeric(10,2),
  criado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recebimento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recebimento_id uuid REFERENCES recebimentos(id) ON DELETE CASCADE,
  embalagem_id uuid REFERENCES embalagens(id),
  quantidade_recebida integer NOT NULL,
  valor_unitario numeric(10,2),
  valor_total numeric(10,2) GENERATED ALWAYS AS (quantidade_recebida * valor_unitario) STORED
);

ALTER TABLE recebimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE recebimento_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON recebimentos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON recebimento_itens FOR ALL USING (true) WITH CHECK (true);

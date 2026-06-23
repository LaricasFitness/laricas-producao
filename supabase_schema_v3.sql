-- ============================================================
-- Laricas Fitness — Controle de Embalagens v3
-- Lógica: produção diária consome embalagem automaticamente
-- ============================================================

-- Embalagens cadastradas (1 produto = 1 embalagem)
CREATE TABLE embalagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,        -- SKU do produto (PM_BRI_100 etc)
  nome text NOT NULL,                 -- Nome exibido no sistema
  categoria text,                     -- Pão de Mel, Barra, Potinho etc
  dias_producao integer DEFAULT 7,    -- 15 para barras/pães de mel, 7 para o resto
  estoque_atual integer DEFAULT 0,    -- Quantidade atual em estoque
  estoque_minimo integer DEFAULT 0,   -- Calculado automaticamente
  margem_seguranca real DEFAULT 0.10, -- 10%
  unidade_minima_grafica integer DEFAULT 100,
  ativo boolean DEFAULT true,
  atualizado_em timestamptz DEFAULT now()
);

-- Registros de produção diária
CREATE TABLE producao_diaria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embalagem_id uuid REFERENCES embalagens(id),
  quantidade integer NOT NULL,
  data_producao date NOT NULL DEFAULT CURRENT_DATE,
  registrado_em timestamptz DEFAULT now()
);

-- Entradas de embalagens (quando chega pedido da gráfica)
CREATE TABLE entradas_embalagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embalagem_id uuid REFERENCES embalagens(id),
  quantidade integer NOT NULL,
  data_entrada date NOT NULL DEFAULT CURRENT_DATE,
  observacao text,
  registrado_em timestamptz DEFAULT now()
);

-- Pedidos para a gráfica
CREATE TABLE pedidos_grafica (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  status text DEFAULT 'enviado',       -- enviado | recebido_total | recebido_parcial
  criado_em timestamptz DEFAULT now(),
  enviado_em date,
  previsao_entrega date,
  observacoes text
);

-- Itens de cada pedido
CREATE TABLE pedido_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid REFERENCES pedidos_grafica(id) ON DELETE CASCADE,
  embalagem_id uuid REFERENCES embalagens(id),
  quantidade_solicitada integer NOT NULL,
  quantidade_recebida integer,
  recebido_em date
);

-- RLS (acesso público para app interno)
ALTER TABLE embalagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_diaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE entradas_embalagem ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_grafica ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all" ON embalagens FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON producao_diaria FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON entradas_embalagem FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON pedidos_grafica FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON pedido_itens FOR ALL USING (true) WITH CHECK (true);

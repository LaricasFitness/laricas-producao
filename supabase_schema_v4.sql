-- ============================================================
-- Laricas Fitness — Schema v4
-- ============================================================

-- Embalagens (1 SKU = 1 embalagem física)
CREATE TABLE embalagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  categoria text,
  dias_producao integer DEFAULT 7,
  estoque_atual integer DEFAULT 0,
  margem_seguranca real DEFAULT 0.10,
  unidade_minima_grafica integer DEFAULT 100,
  ativo boolean DEFAULT true,
  atualizado_em timestamptz DEFAULT now()
);

-- Registros de produção diária (fase 1 — desconta embalagem)
CREATE TABLE producao_diaria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embalagem_id uuid REFERENCES embalagens(id),
  quantidade integer NOT NULL,
  data_producao date NOT NULL DEFAULT CURRENT_DATE,
  registrado_por text,
  registrado_em timestamptz DEFAULT now()
);

-- Registros internos de produção (fases 2-6 — sem impacto em embalagem)
CREATE TABLE producao_interna (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fase text NOT NULL,        -- 'massa' | 'recheio' | 'recheio_pote' | 'cobertura' | 'desperdicio'
  item text NOT NULL,        -- nome da massa/recheio/cobertura ou texto livre (desperdício)
  quantidade real,           -- número de receitas ou pacotes
  unidade text DEFAULT 'receitas',
  observacao text,           -- usado especialmente no desperdício
  data_producao date NOT NULL DEFAULT CURRENT_DATE,
  registrado_por text,
  registrado_em timestamptz DEFAULT now()
);

-- Entradas de embalagens (compras da gráfica)
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
  status text DEFAULT 'enviado',
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

-- RLS
ALTER TABLE embalagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_diaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_interna ENABLE ROW LEVEL SECURITY;
ALTER TABLE entradas_embalagem ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_grafica ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all" ON embalagens FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON producao_diaria FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON producao_interna FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON entradas_embalagem FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON pedidos_grafica FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON pedido_itens FOR ALL USING (true) WITH CHECK (true);

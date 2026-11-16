-- Etiquetas de validade das preparações (massas, recheios, cremes, coberturas)
-- 1) Prazo de validade de cada preparação por conservação (em dias; vazio = não se guarda assim)
-- 2) Cada etiqueta impressa fica registrada, para o controle do que está vencendo e a baixa (usada/descartada)

ALTER TABLE preparacoes
  ADD COLUMN IF NOT EXISTS validade_ambiente_dias    numeric(6,2) CHECK (validade_ambiente_dias > 0),
  ADD COLUMN IF NOT EXISTS validade_refrigerado_dias numeric(6,2) CHECK (validade_refrigerado_dias > 0),
  ADD COLUMN IF NOT EXISTS validade_congelado_dias   numeric(6,2) CHECK (validade_congelado_dias > 0);

CREATE TABLE IF NOT EXISTS etiquetas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero         bigserial UNIQUE,                    -- ID curto impresso na etiqueta
  preparacao_id  uuid REFERENCES preparacoes(id) ON DELETE SET NULL,
  nome           text NOT NULL,                       -- nome da preparação no momento da impressão
  conservacao    text NOT NULL CHECK (conservacao IN ('ambiente', 'refrigerado', 'congelado')),
  manipulado_em  timestamptz NOT NULL,
  validade       timestamptz NOT NULL,
  responsavel    text,
  observacao     text,
  status         text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'usada', 'descartada')),
  baixa_em       timestamptz,
  baixa_por      text,
  motivo         text,
  criado_em      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etiquetas_status_validade ON etiquetas (status, validade);

ALTER TABLE etiquetas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON etiquetas;
CREATE POLICY public_all ON etiquetas FOR ALL USING (true) WITH CHECK (true);

-- Conferência: 3 colunas novas em preparacoes, tabela etiquetas com RLS
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'preparacoes' AND column_name LIKE 'validade_%_dias') AS colunas_prazo,
       (SELECT relrowsecurity FROM pg_class WHERE relname = 'etiquetas') AS rls_etiquetas;

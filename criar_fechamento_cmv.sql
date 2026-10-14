-- Fechamento mensal do CMV real (gerencial).
-- Uma linha por mês × item (matéria-prima ou embalagem), gravada
-- automaticamente pelo sistema a partir do dia 5 do mês seguinte
-- (src/lib/cmv.js → fecharMesesPendentes). Valores congelados: o estoque
-- final de um mês é o inicial do seguinte.
--
-- ORDEM: aplique corrigir_nf_30527.sql ANTES deste arquivo. Assim que esta
-- tabela existir, o primeiro acesso ao sistema fecha setembro/2026.

CREATE TABLE IF NOT EXISTS fechamento_cmv (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes             text NOT NULL,                       -- 'YYYY-MM'
  tipo            text NOT NULL CHECK (tipo IN ('mp', 'emb')),
  item_id         uuid NOT NULL,                       -- materias_primas.id ou embalagens.id
  nome            text,
  categoria       text,
  unidade         text,
  ei_qtd          numeric,                             -- estoque inicial
  ei_valor        numeric,
  ei_origem       text,                                -- fechamento | contagem | calculado
  compras_qtd     numeric,
  compras_valor   numeric,
  atrasadas_qtd   numeric,                             -- compras de meses já fechados lançadas depois
  atrasadas_valor numeric,
  ef_qtd          numeric,                             -- estoque final
  ef_valor        numeric,                             -- valorizado por PEPS
  ef_origem       text,                                -- contagem | calculado
  cmv_qtd         numeric,
  cmv_valor       numeric,
  teorico_qtd     numeric,                             -- produção × ficha técnica
  teorico_valor   numeric,
  fechado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mes, tipo, item_id)
);

CREATE INDEX IF NOT EXISTS fechamento_cmv_mes_idx ON fechamento_cmv (mes);

ALTER TABLE fechamento_cmv ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON fechamento_cmv FOR ALL USING (true) WITH CHECK (true);

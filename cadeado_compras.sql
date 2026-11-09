-- Cadeado de conferência nas compras (Estoque › Compras).
-- Lançamento conferido (cadeado fechado) não pode ser editado nem excluído —
-- nem pela tela, nem por nenhum outro caminho: a trava fica no banco.
-- Para corrigir algo, um administrador abre o cadeado na tela.
-- Só colunas novas em tabelas existentes (RLS já existe, não muda). Pode rodar mais de uma vez.

-- 1. Quem conferiu e quando
ALTER TABLE mp_compras   ADD COLUMN IF NOT EXISTS conferido_em  timestamptz;
ALTER TABLE mp_compras   ADD COLUMN IF NOT EXISTS conferido_por text;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS conferido_em  timestamptz;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS conferido_por text;

-- 2. Trava: com o cadeado fechado, recusa exclusão e qualquer alteração,
--    exceto nas colunas passadas como argumento (o próprio cadeado e, nos
--    recebimentos, o pagamento — pagar uma nota conferida continua permitido).
--    Abrir o cadeado (conferido_em → null) é sempre permitido.
CREATE OR REPLACE FUNCTION trava_lancamento_conferido() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.conferido_em IS NOT NULL THEN
      RAISE EXCEPTION 'Lançamento conferido (cadeado fechado): abra o cadeado antes de excluir.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.conferido_em IS NOT NULL AND NEW.conferido_em IS NOT NULL
     AND (to_jsonb(NEW) - TG_ARGV) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV) THEN
    RAISE EXCEPTION 'Lançamento conferido (cadeado fechado): abra o cadeado antes de editar.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trava_conferido ON mp_compras;
CREATE TRIGGER trava_conferido BEFORE UPDATE OR DELETE ON mp_compras
  FOR EACH ROW EXECUTE FUNCTION trava_lancamento_conferido('conferido_em', 'conferido_por');

DROP TRIGGER IF EXISTS trava_conferido ON recebimentos;
CREATE TRIGGER trava_conferido BEFORE UPDATE OR DELETE ON recebimentos
  FOR EACH ROW EXECUTE FUNCTION trava_lancamento_conferido(
    'conferido_em', 'conferido_por',
    'status_pagamento', 'valor_pago', 'data_pagamento', 'data_agendada', 'obs_pagamento');

-- 3. Itens de recebimento conferido também ficam travados
CREATE OR REPLACE FUNCTION trava_itens_recebimento_conferido() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recebimentos r
              WHERE r.conferido_em IS NOT NULL
                AND r.id IN (OLD.recebimento_id, NEW.recebimento_id)) THEN
    RAISE EXCEPTION 'Recebimento conferido (cadeado fechado): abra o cadeado antes de mudar os itens.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trava_conferido ON recebimento_itens;
CREATE TRIGGER trava_conferido BEFORE INSERT OR UPDATE OR DELETE ON recebimento_itens
  FOR EACH ROW EXECUTE FUNCTION trava_itens_recebimento_conferido();

-- Conferência: 3 gatilhos criados
SELECT event_object_table, trigger_name, string_agg(event_manipulation, ', ') AS eventos
  FROM information_schema.triggers
 WHERE trigger_name = 'trava_conferido'
 GROUP BY 1, 2;

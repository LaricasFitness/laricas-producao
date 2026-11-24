-- DRE Laricas, parte 3: fretes por competência (data do envio)
-- Correios, Lalamove e Melhor Envio entram na DRE de competência pelos relatórios de cada um, envio a envio
-- (Financeiro › DRE › Manuais › Fretes). As faturas e recargas pagas no Bling ficam só no caixa.

CREATE TABLE IF NOT EXISTS dre_fretes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem     text NOT NULL CHECK (origem IN ('correios', 'lalamove', 'melhorenvio')),
  chave      text NOT NULL UNIQUE,      -- origem + id do envio/fatura: reimportar não duplica
  data       date NOT NULL,
  mes        text NOT NULL,
  valor      numeric(12,2) NOT NULL,    -- positivo = custo; crédito/restituição negativo
  descricao  text,
  documento  text,
  por        text,
  em         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dre_fretes_mes ON dre_fretes (mes);
ALTER TABLE dre_fretes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON dre_fretes;
CREATE POLICY public_all ON dre_fretes FOR ALL USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trava_mes ON dre_fretes;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_fretes FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('competencia');

-- Faturas e recargas dessas três no Bling: só no caixa (na competência vêm dos relatórios acima)
INSERT INTO dre_regras (categoria, fornecedor, conta, so_caixa) VALUES
  ('Fretes e seguros', NULL, 'vc.frete', false),
  ('Frete', 'correios', 'vc.frete', true), ('Frete', 'lalamove', 'vc.frete', true), ('Frete', 'melhor envio', 'vc.frete', true),
  ('Fretes e seguros', 'correios', 'vc.frete', true), ('Fretes e seguros', 'lalamove', 'vc.frete', true), ('Fretes e seguros', 'melhor envio', 'vc.frete', true)
ON CONFLICT DO NOTHING;

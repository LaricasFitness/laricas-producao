-- DRE Laricas, parte 2 (aplicar depois do dre_laricas.sql)
-- 1) Equipamentos acima do EBITDA, dentro das outras despesas variáveis (como na planilha)
-- 2) Conta de bonificações (produto dado, sai do CMV)
-- 3) Rateios: despesa dividida em parcelas mensais; os da planilha que ainda não acabaram entram como "legado"

INSERT INTO dre_plano (id, grupo, nome, ordem, so_caixa, cmo) VALUES
  ('vo.equip', 'vo', 'Equipamentos (parcelas e rateios)', 25, false, false),
  ('vm.bonif', 'vm', 'Bonificações (produtos)', 35, false, false)
ON CONFLICT (id) DO NOTHING;

UPDATE dre_plano SET nome = 'Influenciadores e marketing (produtos e envios)' WHERE id = 'vm.influ';
UPDATE dre_plano SET nome = 'Ativação: degustação e premiação' WHERE id = 'vm.ativ';
UPDATE dre_regras SET conta = 'vo.equip' WHERE conta = 'inv.equip';

CREATE TABLE IF NOT EXISTS dre_rateios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao   text NOT NULL,
  conta       text NOT NULL REFERENCES dre_plano(id),
  valor_total numeric(12,2) NOT NULL CHECK (valor_total <> 0),
  parcelas    int NOT NULL CHECK (parcelas BETWEEN 1 AND 60),
  mes_inicio  text NOT NULL CHECK (mes_inicio ~ '^\d{4}-\d{2}$'),
  id_bling    text UNIQUE,          -- conta a pagar do Bling que foi rateada (sai da competência); nulo = legado
  obs         text,
  por         text,
  em          timestamptz DEFAULT now()
);
ALTER TABLE dre_rateios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON dre_rateios;
CREATE POLICY public_all ON dre_rateios FOR ALL USING (true) WITH CHECK (true);

-- Rateios da planilha (aba de competência) que continuam depois de setembro/26 e NÃO estão parcelados no Bling.
-- Os que o Bling já tem em parcelas mensais (frigobares, cooktop, Cetro, datador, cortina de ar, caixas
-- organizadoras, manutenção do PC) ficam de fora para não contar duas vezes.
INSERT INTO dre_rateios (descricao, conta, valor_total, parcelas, mes_inicio, obs, por)
SELECT * FROM (VALUES
  ('Planilha: equipamento 2.800,00 ÷ 12',              'vo.equip', 2800.00::numeric, 12, '2025-12', 'legado da planilha', 'migração'),
  ('Planilha: equipamento 4.748,00 ÷ 12',              'vo.equip', 4748.00, 12, '2026-01', 'legado da planilha', 'migração'),
  ('Planilha: envelopamento frigobares 1.461,38 ÷ 12', 'vo.equip', 1461.38, 12, '2026-04', 'legado da planilha', 'migração'),
  ('Planilha: equipamento 4.221,00 ÷ 12',              'vo.equip', 4221.00, 12, '2026-04', 'legado da planilha', 'migração'),
  ('Planilha: equipamento 2.195,04 ÷ 12',              'vo.equip', 2195.04, 12, '2026-05', 'legado da planilha', 'migração'),
  ('Planilha: manutenção 1.670,00 ÷ 10',               'vo.manut', 1670.00, 10, '2026-03', 'legado da planilha', 'migração'),
  ('Planilha: manutenção 1.932,86 ÷ 10',               'vo.manut', 1932.86, 10, '2026-05', 'legado da planilha', 'migração'),
  ('Planilha: manutenção 900,00 ÷ 9',                  'vo.manut',  900.00,  9, '2026-06', 'legado da planilha', 'migração'),
  ('Planilha: obra Oak 1.093,60 ÷ 10',                 'vo.manut', 1093.60, 10, '2026-06', 'legado da planilha', 'migração')
) AS v(descricao, conta, valor_total, parcelas, mes_inicio, obs, por)
WHERE NOT EXISTS (SELECT 1 FROM dre_rateios r WHERE r.descricao = v.descricao);

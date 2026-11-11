-- Margem por canal: % de custo de cada canal pela DRE-3.0 - 2026 da planilha
-- (CMV ÷ faturamento do canal, média jul a set/26; já inclui embalagens, rótulos, sacolas e caixas).
-- Mercado Livre usa o % do Site (não está na planilha).
-- Venda Direta: agosto ficou em 69%; sem ele, jul e set dão ~35%.

UPDATE dre_cmv_canal AS d
   SET pct = v.pct, atualizado_em = now()
  FROM (VALUES
    ('iFood', 28.2), ('99 Food', 22.9), ('Keeta', 22.9), ('Anota.AI', 23.7),
    ('Site', 24.1), ('Clube', 32.3), ('Mercado Livre', 24.1),
    ('Revenda', 41.7), ('Venda Direta', 48.2), ('Balcão', 26.0), ('Ativação', 30.4)
  ) AS v(canal, pct)
 WHERE d.canal = v.canal;

-- Conferência
SELECT canal, pct FROM dre_cmv_canal ORDER BY canal;

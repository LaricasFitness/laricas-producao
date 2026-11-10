-- Faturamento iFood por loja, jan a out/2026, lido do portal (Financeiro › Faturamento).
-- Rodar no Supabase. Pode rodar mais de uma vez: substitui o mesmo mês × loja.
-- BV = Bela Vista · ZN = Santana · BK = Brooklin · PR = Maringá
-- Em todas as linhas: vendas − promoções − taxas − serviços − anúncios + ajustes = total do faturamento do portal.

-- Coluna de anúncios (pacote de anúncios vai para Marketing) e origem 'portal'
ALTER TABLE dre_canal_competencia ADD COLUMN IF NOT EXISTS marketing numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE dre_canal_competencia DROP CONSTRAINT IF EXISTS dre_canal_competencia_origem_check;
ALTER TABLE dre_canal_competencia ADD CONSTRAINT dre_canal_competencia_origem_check CHECK (origem IN ('print', 'digitado', 'portal'));

INSERT INTO dre_canal_competencia
  (mes, canal, unidade, vendas, promocoes, taxas, servicos, marketing, ajustes, total_faturamento, unidade_print, origem)
VALUES
  ('2026-01', 'iFood', 'BV', 29025.41, 4498.08, 7186.23, 84.93, 943.43, 520.54, 16833.28, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-02', 'iFood', 'BV', 25344.11, 1937.33, 6406.91, 33.98, 0.00, 52.09, 17017.98, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-03', 'iFood', 'BV', 30805.80, 2522.78, 7719.21, 38.97, 0.00, 338.37, 20863.21, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-04', 'iFood', 'BV', 28489.21, 2411.17, 7161.49, 42.96, 0.00, 186.59, 19060.18, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-05', 'iFood', 'BV', 34825.05, 3676.70, 8502.71, 18.98, 300.00, 65.90, 22392.56, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-06', 'iFood', 'BV', 28750.78, 4513.87, 6781.31, 0.00, 0.00, 14.68, 17470.28, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-07', 'iFood', 'BV', 32611.56, 6866.40, 7578.82, 0.00, 0.00, 49.50, 18215.84, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-08', 'iFood', 'BV', 34272.92, 4529.57, 7906.40, 187.91, 0.00, -85.31, 21563.73, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-09', 'iFood', 'BV', 35976.41, 4651.73, 8471.97, 57.97, 0.00, 500.90, 23295.64, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-10', 'iFood', 'BV', 30349.27, 4116.37, 7176.25, 75.97, 0.00, 453.01, 19433.69, 'Laricas Fitness - Bela Vista - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-01', 'iFood', 'ZN', 7091.60, 1561.11, 1627.96, 19.99, 10.31, 13.37, 3885.60, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-02', 'iFood', 'ZN', 6804.50, 1257.70, 1655.07, 25.98, 0.00, 0.00, 3865.75, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-03', 'iFood', 'ZN', 6474.10, 1178.11, 1553.17, 43.96, 0.00, 0.00, 3698.86, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-04', 'iFood', 'ZN', 4922.90, 976.25, 1198.64, 11.99, 0.00, 27.90, 2763.92, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-05', 'iFood', 'ZN', 4944.90, 887.87, 1222.11, 40.97, 186.53, 11.07, 2618.49, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-06', 'iFood', 'ZN', 4024.90, 1363.43, 929.27, 0.00, 476.26, 36.78, 1292.72, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-07', 'iFood', 'ZN', 7867.20, 2084.36, 1782.46, 0.00, 119.81, 0.00, 3880.57, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-08', 'iFood', 'ZN', 6394.70, 1012.86, 1548.55, 0.00, 0.00, 24.08, 3857.37, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-09', 'iFood', 'ZN', 6050.85, 902.80, 1380.13, 0.00, 0.00, 199.59, 3967.51, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-10', 'iFood', 'ZN', 5467.60, 653.99, 1359.59, 0.00, 0.00, 29.94, 3483.96, 'Laricas Fitness - Santana - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-05', 'iFood', 'BK', 399.91, 54.94, 90.37, 0.00, 0.00, 0.00, 254.60, 'Laricas Fitness - Brooklin - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-06', 'iFood', 'BK', 9284.29, 1721.89, 2219.53, 11.79, 0.00, 33.25, 5364.33, 'Laricas Fitness - Brooklin - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-07', 'iFood', 'BK', 11061.00, 2010.95, 2785.05, 0.00, 0.00, 0.00, 6265.00, 'Laricas Fitness - Brooklin - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-08', 'iFood', 'BK', 16275.91, 2469.85, 3909.42, 0.00, 0.00, 48.50, 9945.14, 'Laricas Fitness - Brooklin - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-09', 'iFood', 'BK', 16477.59, 2079.63, 4027.14, 0.00, 0.00, 282.27, 10653.09, 'Laricas Fitness - Brooklin - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-10', 'iFood', 'BK', 15604.95, 2213.30, 3808.90, 0.00, 0.00, 259.46, 9842.21, 'Laricas Fitness - Brooklin - Pães de Mel Proteicos e Doces Fit - O melhor doce da sua vida!', 'portal'),
  ('2026-02', 'iFood', 'PR', 1599.30, 405.56, 352.83, 0.00, 0.00, 0.00, 840.91, 'Laricas Fitness - Doces Proteicos Maringá', 'portal'),
  ('2026-03', 'iFood', 'PR', 4067.10, 1245.13, 911.66, 8.99, 0.00, 14.40, 1915.72, 'Laricas Fitness - Doces Proteicos Maringá', 'portal'),
  ('2026-04', 'iFood', 'PR', 1656.40, 512.34, 373.47, 12.99, 0.00, 0.00, 757.60, 'Laricas Fitness - Doces Proteicos Maringá', 'portal'),
  ('2026-05', 'iFood', 'PR', 3001.50, 1175.61, 645.44, 0.00, 0.00, 0.00, 1180.45, 'Laricas Fitness - Doces Proteicos Maringá', 'portal'),
  ('2026-06', 'iFood', 'PR', 4792.60, 2129.70, 1072.58, 0.00, 0.00, 0.00, 1590.32, 'Laricas Fitness - Doces Proteicos Maringá', 'portal'),
  ('2026-07', 'iFood', 'PR', 13353.79, 3371.35, 2628.88, 0.00, 0.00, 13.70, 7367.26, 'Laricas Fitness - Doces Proteicos Maringá', 'portal'),
  ('2026-08', 'iFood', 'PR', 12626.35, 1303.60, 1831.76, 0.00, 0.00, 16.88, 9507.87, 'Laricas Fitness - Doces Proteicos Maringá', 'portal'),
  ('2026-09', 'iFood', 'PR', 10803.03, 1793.71, 1479.83, 7.99, 0.00, 0.00, 7521.50, 'Laricas Fitness - Doces Proteicos Maringá', 'portal'),
  ('2026-10', 'iFood', 'PR', 9434.99, 1354.58, 1338.59, 0.00, 0.00, 71.15, 6812.97, 'Laricas Fitness - Doces Proteicos Maringá', 'portal')
ON CONFLICT (mes, canal, unidade) DO UPDATE SET
  vendas = EXCLUDED.vendas, promocoes = EXCLUDED.promocoes, taxas = EXCLUDED.taxas, servicos = EXCLUDED.servicos,
  marketing = EXCLUDED.marketing, ajustes = EXCLUDED.ajustes, total_faturamento = EXCLUDED.total_faturamento,
  unidade_print = EXCLUDED.unidade_print, origem = EXCLUDED.origem, atualizado_em = now();

-- Conferência: 35 linhas
SELECT unidade, count(*) AS meses, sum(vendas) AS vendas, sum(total_faturamento) AS recebido
  FROM dre_canal_competencia WHERE canal = 'iFood' AND mes BETWEEN '2026-01' AND '2026-10' GROUP BY unidade ORDER BY unidade;

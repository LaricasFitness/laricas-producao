-- Faturamento Anota.AI (só Bela Vista), ago a out/2026 — o Anota.AI ficou ligado só nesse período.
-- O portal do Anota.AI está bloqueado (assinatura cancelada), então os números vêm de:
--   pedidos   Saipos › Vendas por período, canal "Anota.ai" (cancelados fora): itens, descontos,
--             taxa de entrega e acréscimo de R$ 0,99 por pedido ("taxa adicional via integração")
--   taxas     repasses no extrato do C6 (Pix do iFood "ANOTAAI ACQUIRER/NONACQUIRER"):
--             Pix = R$ 0,99 + 1,00% · cartão = R$ 0,99 + 3,52% (cai em D+30);
--             pedido sem depósito identificado conta como cartão (taxa maior)
-- Receita = itens + entrega + acréscimo · Promoções = descontos · Comissão = taxas acima.
-- A mensalidade não entra aqui: a de agosto (R$ 99,99) veio descontada no repasse do iFood BV.
-- Pode rodar mais de uma vez: substitui o mesmo mês.

INSERT INTO dre_canal_competencia
  (mes, canal, unidade, vendas, promocoes, taxas, servicos, marketing, ajustes, total_faturamento, unidade_print, detalhes, origem)
VALUES
  ('2026-08', 'Anota.AI', 'BV', 1084.56, 100.29, 29.02, 0.00, 0.00, 0.00, 955.25, 'Laricas Fitness - Bela Vista (Anota.ai) · Saipos + extrato C6',
   '[{"grupo":"vendas","descricao":"Itens (10 pedidos)","valor":926.75},{"grupo":"vendas","descricao":"Taxa de entrega","valor":147.91},{"grupo":"vendas","descricao":"Acréscimo R$ 0,99 por pedido","valor":9.90},{"grupo":"promocoes","descricao":"Descontos","valor":-100.29},{"grupo":"taxas","descricao":"Pagamento online: R$ 0,99 + 1% Pix (6) / 3,52% cartão (4)","valor":-29.02}]'::jsonb, 'digitado'),
  ('2026-09', 'Anota.AI', 'BV', 1540.49, 28.90, 57.12, 0.00, 0.00, 0.00, 1454.47, 'Laricas Fitness - Bela Vista (Anota.ai) · Saipos + extrato C6',
   '[{"grupo":"vendas","descricao":"Itens (11 pedidos)","valor":1380.70},{"grupo":"vendas","descricao":"Taxa de entrega","valor":148.90},{"grupo":"vendas","descricao":"Acréscimo R$ 0,99 por pedido","valor":10.89},{"grupo":"promocoes","descricao":"Descontos","valor":-28.90},{"grupo":"taxas","descricao":"Pagamento online: R$ 0,99 + 1% Pix (3) / 3,52% cartão (8)","valor":-57.12}]'::jsonb, 'digitado'),
  ('2026-10', 'Anota.AI', 'BV', 421.12, 7.53, 10.19, 0.00, 0.00, 0.00, 403.40, 'Laricas Fitness - Bela Vista (Anota.ai) · Saipos + extrato C6',
   '[{"grupo":"vendas","descricao":"Itens (4 pedidos)","valor":364.20},{"grupo":"vendas","descricao":"Taxa de entrega","valor":52.96},{"grupo":"vendas","descricao":"Acréscimo R$ 0,99 por pedido","valor":3.96},{"grupo":"promocoes","descricao":"Descontos","valor":-7.53},{"grupo":"taxas","descricao":"Pagamento online: R$ 0,99 + 1% Pix (3) / 3,52% cartão (1)","valor":-10.19}]'::jsonb, 'digitado')
ON CONFLICT (mes, canal, unidade) DO UPDATE SET
  vendas = EXCLUDED.vendas, promocoes = EXCLUDED.promocoes, taxas = EXCLUDED.taxas, servicos = EXCLUDED.servicos,
  marketing = EXCLUDED.marketing, ajustes = EXCLUDED.ajustes, total_faturamento = EXCLUDED.total_faturamento,
  unidade_print = EXCLUDED.unidade_print, detalhes = EXCLUDED.detalhes, origem = EXCLUDED.origem, atualizado_em = now();

-- Conferência: 3 meses; nao_fecha deve ser 0
SELECT count(*) AS meses, sum(vendas) AS vendas, sum(promocoes) AS promocoes, sum(taxas) AS taxas, sum(total_faturamento) AS recebido,
  count(*) FILTER (WHERE abs(vendas - promocoes - taxas - servicos - marketing + ajustes - total_faturamento) > 0.01) AS nao_fecha
FROM dre_canal_competencia WHERE canal = 'Anota.AI';

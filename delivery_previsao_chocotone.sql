-- Previsão de delivery: inclui os 4 Chocotones (zerados) para preencher em Admin › Previsão Delivery.
-- Daqui para frente, produto novo entra pelo botão "Incluir produto" da própria tela.

INSERT INTO delivery_previsao (sku, nome, dia_semana, quantidade)
SELECT e.codigo, e.nome, d.dia, 0
  FROM embalagens e
 CROSS JOIN (VALUES ('seg'), ('ter'), ('qua'), ('qui'), ('sex'), ('sab'), ('dom')) AS d(dia)
 WHERE e.codigo IN ('PM_CHOCO_AVE_100', 'PM_CHOCO_BRI_100', 'PM_CHOCO_DOCE_DE_LEITE_100', 'PM_CHOCO_PISTACHE_100')
ON CONFLICT (sku, dia_semana) DO NOTHING;

-- Conferência: 4 produtos × 7 dias = 28 linhas
SELECT sku, count(*) AS dias FROM delivery_previsao WHERE sku LIKE 'PM_CHOCO%' GROUP BY sku ORDER BY sku;

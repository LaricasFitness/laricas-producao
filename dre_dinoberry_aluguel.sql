-- DRE: IFOOD DINOBERRY é o aluguel do espaço do Delivery Santana (ZN).
-- No Bling ele aparece em "Aluguel Delivery" e, em alguns meses, em "Delivery".
-- Os lançamentos em "Delivery" iam para Despesas variáveis › Comercial; passam para
-- Despesas fixas › Operacional, junto com os de "Aluguel Delivery".
-- Só muda a classificação (dre_mapa): os lançamentos do Bling ficam como estão.

INSERT INTO dre_mapa (origem, categoria, nome, linha, atualizado_em)
VALUES ('competencia', 'Delivery', 'IFOOD DINOBERRY', 'df_operacional', now())
ON CONFLICT (origem, categoria, nome) DO UPDATE SET linha = EXCLUDED.linha, atualizado_em = now();

-- Conferência: deve mostrar Delivery · IFOOD DINOBERRY · df_operacional
-- ("Aluguel Delivery" já vai para df_operacional pela classificação padrão do sistema)
SELECT categoria, nome, linha FROM dre_mapa WHERE nome = 'IFOOD DINOBERRY';

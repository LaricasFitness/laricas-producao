-- Chocotones passam da categoria "Outros" para "Chocotone [SAZONAL]".
-- A marca [SAZONAL] no nome é o que liga o liga/desliga de temporada
-- (Admin › Sistema › Produtos sazonais). Só dados: nenhuma tabela nova.
-- Pode rodar mais de uma vez.

UPDATE embalagens
   SET categoria = 'Chocotone [SAZONAL]', atualizado_em = now()
 WHERE codigo IN ('PM_CHOCO_AVE_100', 'PM_CHOCO_BRI_100',
                  'PM_CHOCO_DOCE_DE_LEITE_100', 'PM_CHOCO_PISTACHE_100');

-- Conferência: devem aparecer os 4 Chocotones
SELECT codigo, nome, categoria, custo_unitario FROM embalagens
 WHERE categoria = 'Chocotone [SAZONAL]' ORDER BY nome;

-- Cadastro inicial de embalagens Laricas v4
-- Categorias com dias_producao: Pão de Mel/Barra = 15 dias, resto = 7 dias

INSERT INTO embalagens (codigo, nome, categoria, dias_producao, unidade_minima_grafica, ativo) VALUES

-- PÃO DE MEL 100g (15 dias)
('PM_BRI_100',           'Pão de Mel de Brigadeiro',          'Pão de Mel 100g',   15, 100, true),
('PM_BJ_100',            'Pão de Mel de Beijinho Preto',      'Pão de Mel 100g',   15, 100, true),
('PM_BJ__BRA_100',       'Pão de Mel de Beijinho Branco',     'Pão de Mel 100g',   15, 100, true),
('PM_AVE_T_100',         'Pão de Mel de Avelã Trufado',       'Pão de Mel 100g',   15, 100, true),
('PM_AME_100',           'Pão de Mel de Pasta de Amendoim',   'Pão de Mel 100g',   15, 100, true),
('PAO_ROMEU_JULIETA_100','Pão de Mel de Romeu e Julieta',     'Pão de Mel 100g',   15, 100, true),
('PM_COOKIES_100',       'Pão de Mel de Cookies''n Cream',    'Pão de Mel 100g',   15, 100, true),
('PM_DOCE_DE_LEITE_100', 'Pão de Mel de Doce de Leite',       'Pão de Mel 100g',   15, 100, true),
('BOLO_CENOURA_100',     'Bolinho de Cenoura Fit',            'Pão de Mel 100g',   15, 100, true),

-- MINI PÃO DE MEL 30g (15 dias)
('MINI_PM_BRI_30',        'MINI Pão de Mel de Brigadeiro',           'Mini Pão de Mel 30g', 15, 200, true),
('MINI_PM_BJ_30',         'MINI Pão de Mel de Beijinho Preto',       'Mini Pão de Mel 30g', 15, 200, true),
('MINI_PM_BJ__BRA_30',    'MINI Pão de Mel de Beijinho Branco',      'Mini Pão de Mel 30g', 15, 200, true),
('MINI_PM_AVE_T_30',      'MINI Pão de Mel de Avelã Trufado',        'Mini Pão de Mel 30g', 15, 200, true),
('MINI_PM_AME_30',        'MINI Pão de Mel de Pasta de Amendoim',    'Mini Pão de Mel 30g', 15, 200, true),
('MINI_PM_COOKIES_30',    'MINI Pão de Mel de Cookies''n Cream',     'Mini Pão de Mel 30g', 15, 200, true),
('MINI_PM_BRI_BRANCO_30', 'MINI Pão de Mel de Brigadeiro Branco',    'Mini Pão de Mel 30g', 15, 200, true),
('MINI_PM_AVE_T_PRETO_30','MINI Pão de Mel de Avelã Trufado Preto',  'Mini Pão de Mel 30g', 15, 200, true),

-- LATAS (7 dias — embalagem da lata física, 1 lata = 8 minis)
('LATA_MINI_PM_8',     'Lata de Mini Pães de Mel',           'Lata Mini 240g', 7, 50, true),
('LATA_EVO_MINI_PM_8', 'Lata de Mini Pães de Mel | Evollution','Lata Mini 240g', 7, 50, true),
('LATA_N2_MINI_PM_8',  'Lata de Mini Pães de Mel | N2',      'Lata Mini 240g', 7, 50, true),
('LATA_O3_MINI_PM_8',  'Lata de Mini Pães de Mel | O3',      'Lata Mini 240g', 7, 50, true),

-- POTINHOS 60g (7 dias)
('BRI_60',         'Brigadeiro de Whey',         'Potinho 60g', 7, 100, true),
('BJ_60',          'Beijinho de Whey',            'Potinho 60g', 7, 100, true),
('PISTACHE_60',    'Pistache Cremoso com Whey',   'Potinho 60g', 7, 100, true),
('AVELA_60',       'Creme de Avelã Trufado',      'Potinho 60g', 7, 100, true),
('ROMEU_JULIETA_60','Romeu e Julieta com Whey',   'Potinho 60g', 7, 100, true),
('COOKIES_60',     'Cookies''n Cream',            'Potinho 60g', 7, 100, true),
('DOCE_DE_LEITE_60','Doce de Leite com Whey',     'Potinho 60g', 7, 100, true),

-- POTÕES 280g (7 dias)
('BRIGADEIRO_POTAO_280',   'Brigadeiro de Whey 280g',         'Potão 280g', 7, 50, true),
('BEIJINHO_POTAO_280',     'Beijinho de Whey 280g',           'Potão 280g', 7, 50, true),
('PISTACHE_POTAO_280',     'Pistache Cremoso com Whey 280g',  'Potão 280g', 7, 50, true),
('AVELA_POTAO_280',        'Creme de Avelã Trufado 280g',     'Potão 280g', 7, 50, true),
('DOCE_DE_LEITE_POTAO_280','Doce de Leite com Whey 280g',     'Potão 280g', 7, 50, true),
('COOKIES_POTAO_280',      'Cookies''n Cream 280g',           'Potão 280g', 7, 50, true),
('ROMEU_JULIETA_POTAO_280','Romeu e Julieta com Whey 280g',   'Potão 280g', 7, 50, true),

-- BARRAS 180g (15 dias)
('BARRA_CHO_180',          'Barra de Brigadeiro de Whey',         'Barra 180g', 15, 100, true),
('BARRA_BRA_180',          'Barra de Avelã Trufado',              'Barra 180g', 15, 100, true),
('BARRA_PISTACHE_180',     'Barra Pistache Cremoso Branca',       'Barra 180g', 15, 100, true),
('BARRA_PISTACHE_CHOC_180','Barra Pistache Cremoso Ao Leite',     'Barra 180g', 15, 100, true),
('BARRA_ROMEU_180',        'Barra de Romeu e Julieta com Whey',   'Barra 180g', 15, 100, true),
('BARRA_COOKIES_180',      'Barra de Cookies''n Cream',           'Barra 180g', 15, 100, true),
('BARRA_BUENISSIMO_180',   'Barra Bueníssimo',                    'Barra 180g', 15, 100, true),
('BARRA_CRUNCH_180',       'Barra Avelã Crunch',                  'Barra 180g', 15, 100, true),
('BARRA_DOCE_DE_LEITE_180','Barra Doce de Leite com Whey',        'Barra 180g', 15, 100, true),

-- BOMBONS (7 dias)
('BOMBOM_01', 'Caixa de Bombons Sortidos Laricas', 'Bombom', 7, 50, true);

-- Caixa 2026: ajustes de embalagem para a margem por canal
-- 1) Neobag (sacolas reutilizáveis, jun a out): contrato cancelado e estornado → sai do caixa importado
-- 2) Latas do Thiago Tardochi (27/08) lançadas em "Embalagens Envio": são embalagem de produto
-- Corrija também no Bling, senão uma nova importação do caixa traz os lançamentos de volta como estavam.

BEGIN;

DELETE FROM dre_caixa_lancamentos
 WHERE id_bling IN ('26108741062', '26353258896', '26634597597', '26881938007', '27183042261')
   AND nome = 'NEOBAG';

UPDATE dre_caixa_lancamentos
   SET categoria = 'CMV - Embalagens Produto'
 WHERE id_bling = '26724168739'
   AND nome = 'THIAGO TARDOCHI SALLES';

COMMIT;

-- Conferência: 0 Neobag; Embalagens Envio jun-out sem latas
SELECT (SELECT count(*) FROM dre_caixa_lancamentos WHERE nome = 'NEOBAG') AS neobag,
       (SELECT round(sum(valor)::numeric, 2) FROM dre_caixa_lancamentos
         WHERE categoria = 'CMV - Embalagens Envio' AND mes BETWEEN '2026-06' AND '2026-10') AS envio_jun_out;

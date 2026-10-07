-- Recalcula preparacoes.rendimento_real_medio como média PONDERADA dos últimos 10
-- registros (Σ rendimento_total ÷ Σ num_receitas), mesma regra de recalcularMedia()
-- em src/pages/Rendimentos.jsx. Preparações sem registro ficam NULL.
UPDATE preparacoes p
SET rendimento_real_medio = s.media,
    atualizado_em = now()
FROM (
  SELECT pr.id,
         (SELECT SUM(u.rendimento_total) / NULLIF(SUM(u.num_receitas), 0)
          FROM (SELECT rendimento_total, num_receitas
                FROM preparacao_rendimento r
                WHERE r.preparacao_id = pr.id
                ORDER BY r.criado_em DESC
                LIMIT 10) u) AS media
  FROM preparacoes pr
) s
WHERE s.id = p.id
  AND p.rendimento_real_medio IS DISTINCT FROM s.media;

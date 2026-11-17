-- Desfaz a SEGUNDA execução de corrigir_saldo_nf37767_2026-11-17.sql.
-- O arquivo rodou duas vezes (17/11 20:24:55 e 20:25:25, horário de Brasília): os saldos
-- receberam as correções em dobro e as contagens foram multiplicadas por 1000 duas vezes.
--
-- Usa o próprio log da segunda execução para saber exatamente o que desfazer e depois
-- apaga esse log. Pode rodar mais de uma vez: da segunda em diante não faz nada.

DO $$
DECLARE
  t_segunda timestamptz;
BEGIN
  SELECT max(criado_em) INTO t_segunda
    FROM log_acoes
   WHERE usuario_nome = 'Sistema (correção)' AND acao = 'corrigir_saldo_mp';

  -- Só existe algo a desfazer se houver duas execuções no log
  IF (SELECT count(DISTINCT criado_em) FROM log_acoes
       WHERE usuario_nome = 'Sistema (correção)' AND acao = 'corrigir_saldo_mp') < 2 THEN
    RAISE NOTICE 'Nada a desfazer: só há uma execução da correção.';
    RETURN;
  END IF;

  -- 1. Saldos: tira o que a segunda execução somou
  UPDATE materias_primas mp
     SET estoque_atual = mp.estoque_atual - s.delta, atualizado_em = now()
    FROM (SELECT registro_id,
                 sum((dados_novos->>'estoque_atual')::numeric - (dados_anteriores->>'estoque_atual')::numeric) AS delta
            FROM log_acoes
           WHERE usuario_nome = 'Sistema (correção)' AND acao = 'corrigir_saldo_mp' AND criado_em = t_segunda
           GROUP BY registro_id) s
   WHERE mp.id = s.registro_id;

  -- 2. Contagens: desfaz o segundo × 1000 e a observação repetida
  UPDATE conferencia_mp c
     SET estoque_contado = c.estoque_contado / 1000,
         observacao = replace(c.observacao,
           ' [corrigido 17/11: contagem estava em kg] [corrigido 17/11: contagem estava em kg]',
           ' [corrigido 17/11: contagem estava em kg]')
   WHERE c.id IN (SELECT registro_id FROM log_acoes
                   WHERE usuario_nome = 'Sistema (correção)' AND acao = 'corrigir_contagem_mp' AND criado_em = t_segunda);

  -- 3. Apaga o log da segunda execução (o da primeira fica como registro)
  DELETE FROM log_acoes WHERE usuario_nome = 'Sistema (correção)' AND criado_em = t_segunda;
END $$;

-- Conferência: Mel ≈ 29.747 g, Achocolatado ≈ 2.140,8 g, Fermento ≈ 861,7 g,
-- contagens de Mel 21.000 / 8.000 / 8.700 e Achocolatado 630
SELECT nome, round(estoque_atual, 1) AS saldo FROM materias_primas
 WHERE id IN ('a47da9fc-15e8-4cab-a360-a1f551643351', 'edd24b3f-83d6-467f-aa55-a9c39a8bc8ba',
              'a55320b5-80fd-47a9-bd5b-bcd6107d0319', '0bde8ef5-58f5-4e8b-987c-cd0b8d20980f')
UNION ALL
SELECT 'contagem ' || to_char(data_conferencia, 'DD/MM') || ' ' || left(observacao, 0) ||
       (SELECT nome FROM materias_primas WHERE id = materia_prima_id), estoque_contado
  FROM conferencia_mp
 WHERE id IN ('5f9b40a5-f935-47d2-bf93-c2919f6ef035', '18f5b1f8-9a6e-4288-9c1c-a6285e8bd6f1',
              'ed724eb5-f47f-401b-979a-6b12b20d1071', '1155897f-5f5a-4218-94fa-bdafadf3d2e5');

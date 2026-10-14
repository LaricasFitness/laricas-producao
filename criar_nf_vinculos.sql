-- Memória de vínculos de nota fiscal: descrição do item no fornecedor → matéria-prima.
-- Gravada ao lançar uma compra pela foto da NF ou pelo XML; na próxima nota do
-- mesmo fornecedor o vínculo e a conversão de unidade já vêm preenchidos.
-- Sem esta tabela tudo funciona, só não lembra os vínculos.

CREATE TABLE IF NOT EXISTS nf_vinculos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_chave   text NOT NULL,          -- CNPJ (só dígitos) ou nome normalizado
  fornecedor_nome    text,
  descricao          text NOT NULL,          -- descrição do item na nota, normalizada
  materia_prima_id   uuid NOT NULL REFERENCES materias_primas(id) ON DELETE CASCADE,
  unidade_compra     text,                   -- kg, caixa, pacote...
  conteudo_embalagem numeric,
  unidade_conteudo   text,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fornecedor_chave, descricao)
);

ALTER TABLE nf_vinculos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON nf_vinculos FOR ALL USING (true) WITH CHECKa (true);

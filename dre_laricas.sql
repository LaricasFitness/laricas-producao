-- DRE Laricas (Financeiro › DRE): plano de contas próprio, regras do Bling → plano, classificação por
-- lançamento, receitas do mês por canal, lançamentos manuais e saldos dos bancos para a auditoria.
-- Despesas vêm do Bling (contas a pagar pela competência; extrato para o caixa); o Bling é só leitura.
-- Pode rodar de novo sem problema (não apaga nada; os dados iniciais só entram se ainda não existem).

-- 0) Id do Bling nas contas a pagar (para a classificação de cada lançamento sobreviver às atualizações)
ALTER TABLE dre_contas_competencia ADD COLUMN IF NOT EXISTS id_bling text;
CREATE INDEX IF NOT EXISTS dre_contas_competencia_id_bling_idx ON dre_contas_competencia (id_bling);

-- 1) Plano de contas. grupo = bloco fixo da DRE (rec, ded, cmv, vc, vm, vo, fo, fa, fm, fc, fin, inv, fora).
--    so_caixa: conta que na competência vem de outra fonte (CMV do fechamento de estoque, envio estimado).
CREATE TABLE IF NOT EXISTS dre_plano (
  id        text PRIMARY KEY,
  grupo     text NOT NULL,
  nome      text NOT NULL,
  ordem     integer NOT NULL DEFAULT 0,
  so_caixa  boolean NOT NULL DEFAULT false,
  cmo       boolean NOT NULL DEFAULT false,      -- entra no CMO (mão de obra)
  ativo     boolean NOT NULL DEFAULT true
);
INSERT INTO dre_plano (id, grupo, nome, ordem, so_caixa, cmo) VALUES
  ('rec.site','rec','Site',10,false,false), ('rec.delivery','rec','Delivery (iFood, 99, Keeta, Anota.AI)',20,false,false),
  ('rec.mkt','rec','Marketplace (Mercado Livre)',25,false,false), ('rec.clube','rec','Clube de assinatura',30,false,false),
  ('rec.b2b','rec','Revenda',40,false,false), ('rec.direta','rec','Venda direta',50,false,false), ('rec.balcao','rec','Balcão',60,false,false),
  ('rec.ativ','rec','Ativação e eventos',70,false,false), ('rec.lic','rec','Licenciamento e royalties',80,false,false),
  ('ded.desc','ded','Descontos e promoções',10,false,false), ('ded.imp','ded','Impostos sobre vendas (DAS)',20,false,false),
  ('cmv.mp','cmv','Matéria-prima (fechamento de estoque)',10,true,false), ('cmv.emb','cmv','Embalagem do produto (fechamento de estoque)',20,true,false),
  ('cmv.envio','cmv','Embalagem de envio (R$ por pedido)',30,true,false), ('cmv.insumos','cmv','Insumos auxiliares (luvas, toucas, filme, alumínio)',40,false,false),
  ('vc.taxas','vc','Comissões e taxas das plataformas',10,false,false), ('vc.cartao','vc','Cartão e meios de pagamento',20,false,false), ('vc.frete','vc','Frete e entregas',30,false,false),
  ('vm.midia','vm','Mídia paga (Meta, Google)',10,false,false), ('vm.influ','vm','Influenciadores e produtos enviados',20,false,false),
  ('vm.ativ','vm','Ativação e degustação',30,false,false), ('vm.ferr','vm','Ferramentas de marketing',40,false,false), ('vm.outros','vm','Outros (produção de conteúdo)',50,false,false),
  ('vo.manut','vo','Manutenção',10,false,false), ('vo.utens','vo','Utensílios e equipamentos pequenos',20,false,false), ('vo.limpeza','vo','Limpeza e higiene',30,false,false),
  ('vo.testes','vo','Testes de produto',40,false,false), ('vo.outras','vo','Outras (OP e ADM)',50,false,false),
  ('fo.aluguel','fo','Aluguéis (produção e dark kitchens)',10,false,false), ('fo.energia','fo','Energia',20,false,false),
  ('fo.equipe','fo','Equipe de produção e operação',30,false,true), ('fo.sist','fo','Sistemas',40,false,false), ('fo.serv','fo','Serviços (consultoria, limpeza do tanque)',50,false,false),
  ('fa.contab','fa','Contabilidade',10,false,false), ('fa.prolabore','fa','Pró-labore',20,false,true), ('fa.outras','fa','Outras administrativas',30,false,false),
  ('fm.agencia','fm','Agência, design e social media',10,false,false), ('fm.equipe','fm','Equipe de marketing',20,false,true),
  ('fc.equipe','fc','Equipe comercial',10,false,true),
  ('fin.rec','fin','Receitas financeiras',10,false,false), ('fin.desp','fin','Despesas financeiras',20,false,false),
  ('inv.equip','inv','Equipamentos e obras',10,false,false),
  ('fora.transf','fora','Transferências entre contas',10,false,false), ('fora.aporte','fora','Aportes, venda de ativo e outras entradas',20,false,false),
  ('fora.ajuste','fora','Ajustes de saldo no Bling (sem dinheiro)',30,false,false)
ON CONFLICT (id) DO NOTHING;

-- 2) Regras: categoria do Bling (e, opcionalmente, parte do nome do fornecedor) → conta do plano.
--    Regra com fornecedor vale antes da regra só da categoria. so_caixa: na competência a conta vem de outra
--    fonte (ex.: Tráfego Pago do Bling só no caixa; na competência, a planilha da agência, lançada à mão).
CREATE TABLE IF NOT EXISTS dre_regras (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria   text NOT NULL,
  fornecedor  text,
  conta       text NOT NULL REFERENCES dre_plano(id),
  so_caixa    boolean NOT NULL DEFAULT false,
  criado_em   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dre_regras_unica ON dre_regras (categoria, coalesce(fornecedor, ''));
INSERT INTO dre_regras (categoria, fornecedor, conta, so_caixa) VALUES
  ('CMV - Matéria Prima',NULL,'cmv.mp',false), ('CMV - Embalagens Produto',NULL,'cmv.emb',false), ('CMV - Embalagens Envio',NULL,'cmv.envio',false),
  ('CMV - Aux. Operação',NULL,'cmv.insumos',false), ('Frete',NULL,'vc.frete',false), ('Comissão Vendas',NULL,'vc.taxas',false), ('Impostos sobre vendas',NULL,'ded.imp',false),
  ('Tráfego Pago',NULL,'vm.midia',true), ('Outros Digital',NULL,'vm.midia',false), ('Influenciadores',NULL,'vm.influ',false),
  ('Ativação',NULL,'vm.ativ',false), ('Ativação - Degustação',NULL,'vm.ativ',false),
  ('Manutenção',NULL,'vo.manut',false), ('Manutenção da Produção',NULL,'vo.manut',false), ('Manutenção de Equipamento',NULL,'vo.manut',false), ('Manutenção/Obra',NULL,'vo.manut',false),
  ('Equipamentos sem valor',NULL,'vo.utens',false), ('Outros OP',NULL,'vo.utens',false), ('Limpeza e Higiêne',NULL,'vo.limpeza',false), ('Testes',NULL,'vo.testes',false),
  ('Outros ADM',NULL,'vo.outras',false), ('Outros',NULL,'vo.outras',false),
  ('Aluguel Produção',NULL,'fo.aluguel',false), ('Aluguel Delivery',NULL,'fo.aluguel',false), ('Delivery',NULL,'fo.aluguel',false), ('Luz',NULL,'fo.energia',false),
  ('Salário',NULL,'fo.equipe',false), ('Adiantamento Salarial',NULL,'fo.equipe',false), ('INSS',NULL,'fo.equipe',false), ('FGTS',NULL,'fo.equipe',false),
  ('Transporte',NULL,'fo.equipe',false), ('Alimentação',NULL,'fo.equipe',false), ('Uniforme',NULL,'fo.equipe',false),
  ('Sistema',NULL,'fo.sist',false), ('Sistemas',NULL,'fo.sist',false), ('Consultorias/Prestadores',NULL,'fo.serv',false),
  ('Prestador de Serviço',NULL,'fm.agencia',false), ('Salario Pessoal',NULL,'fa.prolabore',false),
  ('Tarifa bancária',NULL,'fin.desp',false), ('Acréscimos pagos',NULL,'fin.desp',false), ('Rendimento de aplicação financeira',NULL,'fin.rec',false), ('Juros recebidos',NULL,'fin.rec',false),
  ('Equipamento',NULL,'inv.equip',false), ('Equipamentos',NULL,'inv.equip',false), ('Mobília',NULL,'inv.equip',false),
  ('iFood',NULL,'rec.delivery',false), ('99 Food',NULL,'rec.delivery',false), ('Keeta',NULL,'rec.delivery',false), ('Anota.Ai',NULL,'rec.delivery',false),
  ('Venda Site',NULL,'rec.site',false), ('Revenda',NULL,'rec.b2b',false), ('Venda Direta',NULL,'rec.direta',false), ('Venda Balcão',NULL,'rec.balcao',false), ('Venda Ativação',NULL,'rec.ativ',false),
  ('Venda de ativo',NULL,'fora.aporte',false), ('Transferências de entrada',NULL,'fora.transf',false), ('Transferências de saída',NULL,'fora.transf',false),
  ('Transferências',NULL,'fora.transf',false), ('Transferências recebidas',NULL,'fora.aporte',false), ('Ajuste de saldo',NULL,'fora.ajuste',false),
  ('Salario Pessoal','nathalia','fm.equipe',false), ('Salario Pessoal','giselle','fm.equipe',false), ('Prestador de Serviço','leovini','fa.contab',false),
  ('Outros','navarro','vm.outros',false), ('Outros','pgr','fo.equipe',false), ('Sistemas','rits','vc.cartao',false),
  ('Limpeza e Higiêne','restoclean','fo.serv',false), ('Limpeza e Higiêne','kelly','fo.equipe',false)
ON CONFLICT DO NOTHING;

-- 3) Classificação à mão de um lançamento (vence a regra e continua quando o Bling é atualizado)
CREATE TABLE IF NOT EXISTS dre_classificacao (
  origem     text NOT NULL CHECK (origem IN ('pagar', 'caixa')),
  id_bling   text NOT NULL,
  conta      text NOT NULL REFERENCES dre_plano(id),
  por        text,
  em         timestamptz DEFAULT now(),
  PRIMARY KEY (origem, id_bling)
);

-- 4) Receitas do mês por canal (competência): bruto, descontos/promoções (deduções), comissão da plataforma
--    (despesa variável comercial) e nº de pedidos (embalagem de envio)
CREATE TABLE IF NOT EXISTS dre_receitas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes        text NOT NULL,
  canal      text NOT NULL,
  conta      text NOT NULL REFERENCES dre_plano(id),
  bruto      numeric(14,2) NOT NULL DEFAULT 0,
  descontos  numeric(14,2) NOT NULL DEFAULT 0,
  comissao   numeric(14,2) NOT NULL DEFAULT 0,
  pedidos    integer NOT NULL DEFAULT 0,
  obs        text,
  ordem      integer NOT NULL DEFAULT 0,
  por        text,
  em         timestamptz DEFAULT now(),
  UNIQUE (mes, canal)
);

-- 5) Lançamentos manuais (competência): taxas descontadas na venda, mídia da planilha da agência, acertos sem
--    caixa, reclassificações (valor negativo) e anuidades divididas por 12
CREATE TABLE IF NOT EXISTS dre_manuais (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes        text NOT NULL,
  descricao  text NOT NULL,
  conta      text NOT NULL REFERENCES dre_plano(id),
  valor      numeric(14,2) NOT NULL,
  por        text,
  em         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dre_manuais_mes_idx ON dre_manuais (mes);

-- 6) Saldo final de cada conta bancária no mês (do extrato do banco): a auditoria confere a variação com o caixa
CREATE TABLE IF NOT EXISTS dre_saldos (
  mes    text NOT NULL,
  conta  text NOT NULL,                 -- nome da conta como no Bling (C6 BANK, Banco Inter - Brooklin…)
  saldo  numeric(14,2) NOT NULL,
  por    text,
  em     timestamptz DEFAULT now(),
  PRIMARY KEY (mes, conta)
);

-- RLS (o navegador grava, como nas outras tabelas da DRE)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dre_plano','dre_regras','dre_classificacao','dre_receitas','dre_manuais','dre_saldos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS public_all ON %I', t);
    EXECUTE format('CREATE POLICY public_all ON %I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Cadeado: mês fechado na DRE não aceita mudança nas receitas, nos manuais nem nos saldos
DROP TRIGGER IF EXISTS trava_mes ON dre_receitas;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_receitas FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('competencia');
DROP TRIGGER IF EXISTS trava_mes ON dre_manuais;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_manuais FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('competencia');
DROP TRIGGER IF EXISTS trava_mes ON dre_saldos;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_saldos FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('caixa');

-- Embalagem de envio estimada por pedido (R$)
INSERT INTO configuracoes (chave, valor, descricao)
SELECT 'dre_embalagem_envio', '1.75', 'Custo estimado de embalagem de envio por pedido (sacola/caixa, etiquetas, bolha, fita) — DRE por competência'
WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE chave = 'dre_embalagem_envio');

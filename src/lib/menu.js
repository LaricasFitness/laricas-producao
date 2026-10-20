import { ClipboardList, Truck, Package, CircleDollarSign, Settings } from 'lucide-react'

// Menu do sistema: áreas e as subtelas de cada uma.
// No desktop as subtelas aparecem embaixo da área, no menu lateral.
// No celular a barra inferior mostra só as áreas, e as subtelas
// aparecem como abas no topo da própria tela (classe .hub-tabs).
// Os ids das subtelas são os mesmos que cada hub já usava.
export const MENU = [
  {
    id: 'producao', label: 'Produção', Icon: ClipboardList,
    subs: [
      { id: 'registro',     label: 'Registro' },
      { id: 'planejamento', label: 'Planejamento' },
      { id: 'analise',      label: 'Análise' },
      { id: 'log',          label: 'Log' },
      { id: 'historico',    label: 'Histórico' },
      { id: 'rendimentos',  label: 'Rendimentos' },
      { id: 'acoes',        label: 'Minhas ações' },
    ],
  },
  {
    id: 'logistica', label: 'Logística', Icon: Truck,
    subs: [
      { id: 'roteiro',   label: 'Roteiro' },
      { id: 'historico', label: 'Histórico' },
    ],
  },
  {
    id: 'estoque', label: 'Estoque', Icon: Package,
    subs: [
      { id: 'situacao',    label: 'Situação' },
      { id: 'conferencia', label: 'Conferência' },
      { id: 'compras',     label: 'Compras' },
      { id: 'precos',      label: 'Preços' },
      { id: 'consumo',     label: 'Consumo' },
      { id: 'pedidos',     label: 'Pedidos à gráfica' },
    ],
  },
  {
    id: 'precificacao', label: 'Custos', Icon: CircleDollarSign,
    subs: [
      { id: 'ficha',       label: 'Ficha de custo' },
      { id: 'simulador',   label: 'Markup e canais' },
      { id: 'ranking',     label: 'Ranking de margem' },
      { id: 'evolucao',    label: 'Evolução do CMV' },
      { id: 'estoque',     label: 'CMV do mês' },
      { id: 'preparacoes', label: 'Custo de preparações' },
      { id: 'overhead',    label: 'Overhead do mês' },
      { id: 'simular',     label: 'Criar produto' },
      { id: 'campanha',    label: 'Simular campanha' },
    ],
  },
  {
    id: 'admin', label: 'Admin', Icon: Settings,
    subs: [
      { id: 'embalagens',         label: 'Cadastro de embalagens' },
      { id: 'delivery_previsao',  label: 'Previsão delivery' },
      { id: 'fichas_preparacoes', label: 'Preparações' },
      { id: 'fichas_produtos',    label: 'Composição e embalagem' },
      { id: 'canais',             label: 'Canais' },
      { id: 'overhead',           label: 'Custos fixos' },
      { id: 'sistema',            label: 'Sistema' },
      { id: 'usuarios',           label: 'Usuários e acessos' },
    ],
  },
]

export const subPadrao = pageId => MENU.find(m => m.id === pageId)?.subs[0]?.id
export const rotuloSub = (pageId, subId) => MENU.find(m => m.id === pageId)?.subs.find(s => s.id === subId)?.label

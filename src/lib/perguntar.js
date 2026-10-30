// Pergunta com botões próprios, usando o estilo de modal do sistema.
// (window.confirm só tem OK/Cancelar, o que confundiria em decisões de estoque.)
// opcoes: [{ valor, rotulo, classe }] — devolve o valor do botão clicado.
export function perguntar({ titulo, texto, itens = [], opcoes }) {
  return new Promise(resolve => {
    const fundo = document.createElement('div')
    fundo.className = 'modal-overlay'
    fundo.style.zIndex = 400

    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.style.maxWidth = '480px'

    const cab = document.createElement('div')
    cab.className = 'modal-header'
    const tit = document.createElement('div')
    tit.className = 'modal-title'
    tit.textContent = titulo
    cab.appendChild(tit)

    const corpo = document.createElement('div')
    corpo.className = 'modal-body'
    const p = document.createElement('div')
    p.style.cssText = 'font-size:13px;line-height:1.6;color:var(--gray-600);white-space:pre-line'
    p.textContent = texto
    corpo.appendChild(p)
    if (itens.length) {
      const lista = document.createElement('div')
      lista.style.cssText = 'font-size:13px;font-weight:600;line-height:1.7'
      lista.textContent = itens.map(i => '• ' + i).join('\n')
      lista.style.whiteSpace = 'pre-line'
      corpo.appendChild(lista)
    }

    const rodape = document.createElement('div')
    rodape.className = 'modal-footer'
    rodape.style.flexDirection = 'column'
    for (const o of opcoes) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `btn ${o.classe || 'btn-ghost'}`
      b.style.whiteSpace = 'normal'
      b.textContent = o.rotulo
      b.onclick = () => { fundo.remove(); resolve(o.valor) }
      rodape.appendChild(b)
    }

    modal.append(cab, corpo, rodape)
    fundo.appendChild(modal)
    document.body.appendChild(fundo)
  })
}

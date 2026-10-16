// Marca as grades com colunas fixas em px (ex.: '32px 1fr 140px 120px') com a
// classe "grade-px", que o App.css transforma em 2 colunas fluidas no celular.
// CSS sozinho não consegue: um seletor [style*="px"] também pega o "gap: 16px"
// de qualquer grade. Aqui olhamos só o valor de grid-template-columns.
export function observarGradesFixas(raiz = document.body) {
  const marcar = () => {
    for (const el of raiz.querySelectorAll('[style*="grid-template-columns"]')) {
      const cols = el.style.gridTemplateColumns || ''
      el.classList.toggle('grade-px', /\d+px/.test(cols) && !cols.includes('minmax'))
      // 1ª célula só com ícone/emoji: no celular some, e o nome vira a 1ª coluna
      const primeira = el.firstElementChild
      if (primeira) primeira.classList.toggle('grade-icone', el.classList.contains('grade-px') &&
        (primeira.textContent || '').trim().length <= 2 && !primeira.querySelector('input,select,button'))
    }
  }
  let agendado = false
  const obs = new MutationObserver(() => {
    if (agendado) return
    agendado = true
    requestAnimationFrame(() => { agendado = false; marcar() })
  })
  obs.observe(raiz, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  marcar()
  return () => obs.disconnect()
}

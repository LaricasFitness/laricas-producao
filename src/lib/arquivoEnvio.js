// Reduz a foto antes de enviar (limite de 4,5 MB por requisição no Vercel)
export function arquivoParaEnvio(file, { rotuloPdf = 'envie uma foto da nota' } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo'))
    if (file.type === 'application/pdf') {
      if (file.size > 3_000_000) return reject(new Error(`PDF maior que 3 MB — ${rotuloPdf}`))
      reader.onload = () => resolve({ media_type: 'application/pdf', data: String(reader.result).split(',')[1] })
      return reader.readAsDataURL(file)
    }
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Formato de imagem não suportado — use JPG ou PNG'))
      img.onload = () => {
        const MAX = 2400
        const escala = Math.min(1, MAX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * escala)
        canvas.height = Math.round(img.height * escala)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve({ media_type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}


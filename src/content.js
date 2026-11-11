'use strict';
// Conteúdo editorial do site que não muda pelo painel.
// Tudo entre [colchetes] é campo para substituir pelos dados reais da barbearia.
// Fotos: coloque os arquivos em public/img/ (de preferência .webp, até ~250 KB) e informe o caminho em "src".
// Enquanto "src" estiver vazio, o site mostra um espaço identificado para a foto.

module.exports = {
  hero: {
    image: { src: '', alt: 'Interior da barbearia', label: 'Foto principal: cadeira de barbeiro ou fachada (vertical, 1200×1500)' },
  },

  about: {
    // Parágrafos da página "Sobre". Não invente história, prêmios ou datas: use só o que o cliente confirmar.
    paragraphs: [
      '[HISTÓRIA DA BARBEARIA: quem fundou, quando e por quê. Dados reais fornecidos pelo cliente.]',
      '[O QUE TORNA O ATENDIMENTO ESPECIAL: estilo, ambiente, cuidado com o cliente.]',
    ],
    image: { src: '', alt: 'Ambiente da barbearia', label: 'Foto do ambiente (horizontal, 1600×1000)' },
    values: [
      { title: 'Hora marcada de verdade', text: 'Você escolhe o horário pelo site e o sistema só mostra o que está livre.' },
      { title: 'Profissional da sua escolha', text: 'Agende com quem você já conhece ou com o primeiro disponível.' },
      { title: 'Preço claro antes de sentar', text: 'Valor e duração de cada serviço aparecem antes de confirmar.' },
    ],
  },

  gallery: [
    { src: '', alt: '', label: 'Foto de corte (degradê)', caption: '' },
    { src: '', alt: '', label: 'Foto de barba', caption: '' },
    { src: '', alt: '', label: 'Foto do ambiente', caption: '' },
    { src: '', alt: '', label: 'Foto de corte (tesoura)', caption: '' },
    { src: '', alt: '', label: 'Foto de detalhe (ferramentas)', caption: '' },
    { src: '', alt: '', label: 'Foto de corte infantil', caption: '' },
    { src: '', alt: '', label: 'Foto da fachada', caption: '' },
    { src: '', alt: '', label: 'Foto da equipe', caption: '' },
    { src: '', alt: '', label: 'Foto de acabamento', caption: '' },
    { src: '', alt: '', label: 'Foto da recepção', caption: '' },
  ],

  // Depoimentos SÓ com autorização do cliente. Exemplo de formato:
  // { text: 'Texto exatamente como o cliente escreveu.', author: 'Nome Sobrenome', source: 'Google' }
  // Enquanto a lista estiver vazia, a seção de depoimentos não aparece no site.
  testimonials: [],
};

// Passed directly to the browser. One synchronous read prevents a responsive
// React commit from separating the page text from its heading and ranks.
export function collectActivitySnapshot(main, phone) {
  const surface = main.querySelector(phone ? '.co-page' : '.checkout.da-page');
  if (!surface || !surface.getClientRects().length) throw new Error('Intended activity surface is not visible');
  const header = phone ? null : main.querySelector('.s2-head .s2-idtx');
  if (!phone && (!header || !header.getClientRects().length)) throw new Error('Desktop activity heading is not visible');
  return {
    text: main.innerText,
    header: header?.innerText ?? null,
    ranks: phone ? [] : [...main.querySelectorAll('.da-pod, .da-lbrow')]
      .filter(node => node.getClientRects().length)
      .map(node => ({text: node.innerText, rank: node.querySelector('.da-medal .dotnum')?.getAttribute('aria-label') || node.querySelector('.da-medal')?.textContent.trim()})),
    numbers: [...main.querySelectorAll('.co-unum .dotnum')].map(node => node.getAttribute('aria-label')),
    context: {width: main.ownerDocument.defaultView.innerWidth, phone, ready: main.dataset.fixtureReady, store: main.dataset.fixtureStore},
  };
}

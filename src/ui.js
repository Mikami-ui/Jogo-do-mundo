// Interface: o HTML e o CSS do jogo vêm embutidos no próprio game.js e são montados aqui.
// Assim a página (index.html) é só uma casca e uma versão antiga dela, guardada no aparelho, nunca quebra o jogo.
import HTML from '../ui.html';
import CSS from '../style.css';

export function mountUI() {
  for (const id of ['hud', 'start', 'menu', 'flash', 'boot0']) document.getElementById(id)?.remove();
  document.querySelectorAll('link[rel="stylesheet"][href$="style.css"], style#jdm-css').forEach((e) => e.remove());
  const st = document.createElement('style'); st.id = 'jdm-css'; st.textContent = CSS; document.head.appendChild(st);
  if (!document.getElementById('c')) { const c = document.createElement('canvas'); c.id = 'c'; document.body.prepend(c); }
  if (!document.querySelector('link[href*="Barlow+Condensed"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;1,700;1,800&family=Inter:wght@400;500;600&display=swap';
    document.head.appendChild(l);
  }
  document.body.insertAdjacentHTML('beforeend', HTML);
}

// mostra o erro na tela (no celular não há console): mensagem, onde aconteceu e um botão para recarregar
let shown = 0;
export function reportError(e) {
  console.error(e);
  if (shown++ > 0) return;
  const msg = (e && (e.message || String(e))) || 'erro desconhecido';
  const where = ((e && e.stack) || '').split('\n').slice(1, 3).map((l) => l.trim().replace(/https?:\/\/[^/]+\//g, '')).join(' · ');
  const d = document.createElement('div'); d.id = 'jdm-err';
  d.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:99;background:rgba(120,20,20,.94);color:#fff;font:13px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:10px;';
  d.innerHTML = '<b>O jogo encontrou um erro.</b> Tire um print desta mensagem e me envie.<br><span></span><br><button style="margin-top:8px;padding:7px 14px;border:0;border-radius:8px;font:inherit;font-weight:600">Recarregar</button> <button style="margin-top:8px;padding:7px 14px;border:0;border-radius:8px;font:inherit;background:rgba(255,255,255,.2);color:#fff">Fechar</button>';
  d.querySelector('span').textContent = msg + (where ? ' — ' + where : '');
  const [reload, close] = d.querySelectorAll('button');
  reload.onclick = () => location.reload(); close.onclick = () => d.remove();
  document.body.appendChild(d);
}
window.addEventListener('error', (ev) => { if (ev.error) reportError(ev.error); });

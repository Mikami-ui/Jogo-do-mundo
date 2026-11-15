// Carregador. O jogo inteiro (código, interface e estilo) fica num único arquivo, game.js, gerado por build.sh
// a partir de src/app.js. O parâmetro ?v= muda a cada versão, então o navegador nunca mistura arquivos de versões diferentes.
import('../game.js?v=c9013033da').catch((e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;background:#0b0d12;color:#f4f1ea;font:15px/1.5 system-ui,sans-serif;z-index:99';
  d.innerHTML = '<div>Não foi possível carregar o jogo.<br>Confira a internet e toque para tentar de novo.<br><small style="opacity:.6"></small></div>';
  d.querySelector('small').textContent = String(e && e.message || e);
  d.onclick = () => location.reload();
  document.body.appendChild(d);
});

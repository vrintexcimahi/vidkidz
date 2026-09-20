const roleButtons = [...document.querySelectorAll('.role-switch__btn')];
const screens = [...document.querySelectorAll('.role-screen')];
const toast = document.querySelector('#toast');

function setRole(role){
  roleButtons.forEach(btn => btn.classList.toggle('is-active', btn.dataset.role === role));
  screens.forEach(screen => screen.classList.toggle('is-current', screen.dataset.screen === role));
  localStorage.setItem('vrintex-ui-role', role);
}

roleButtons.forEach(btn => btn.addEventListener('click', () => setRole(btn.dataset.role)));
document.querySelectorAll('.js-role').forEach(btn => btn.addEventListener('click', () => setRole(btn.dataset.target)));

document.querySelectorAll('.bottom-nav').forEach(nav => {
  nav.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => {
    nav.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
  }));
});

let toastTimer;
function showToast(message){
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}
document.querySelectorAll('.js-toast').forEach(btn => btn.addEventListener('click', () => showToast(btn.dataset.message || 'Aksi berhasil')));

const saved = localStorage.getItem('vrintex-ui-role') || 'admin';
setRole(saved);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

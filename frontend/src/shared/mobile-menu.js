/* ==================== MOBILE-MENU.JS ====================
   Menu hambúrguer + drawer deslizante para todas as páginas
   Injetado automaticamente pelo utils.js
*/

(function initMobileMenu() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }

  function setup() {
    injectMobileHeader();
    injectHamburgerButton();
    injectOverlay();
    // Aguarda sidebar ser carregada no DOM
    setTimeout(attachEvents, 150);
  }

  function injectMobileHeader() {
    if (document.getElementById('mobile-header')) return;
    const header = document.createElement('div');
    header.id = 'mobile-header';
    header.className = 'mobile-header';
    header.innerHTML = `
      <div class="mobile-header-logo">
        <svg viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="20" fill="#1EAF6A"/>
          <path d="M24 12L30 18L24 24L18 18L24 12Z" fill="white"/>
          <path d="M24 24L30 30L24 36L18 30L24 24Z" fill="white" opacity="0.7"/>
        </svg>
        <span>Loopin TV</span>
      </div>
    `;
    document.body.insertBefore(header, document.body.firstChild);
  }

  function injectHamburgerButton() {
    if (document.getElementById('hamburger-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'hamburger-btn';
    btn.className = 'hamburger-btn';
    btn.setAttribute('aria-label', 'Abrir menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `
      <span class="bar"></span>
      <span class="bar"></span>
      <span class="bar"></span>
    `;
    document.body.insertBefore(btn, document.body.firstChild);
  }

  function injectOverlay() {
    if (document.getElementById('sidebar-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  function attachEvents() {
    const btn      = document.getElementById('hamburger-btn');
    const overlay  = document.getElementById('sidebar-overlay');
    const sidebar  = document.getElementById('sidebar-container');

    if (!btn || !overlay) return;

    btn.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', closeMenu);

    // Fecha com Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    // Fecha ao clicar em link da sidebar no mobile
    if (sidebar) {
      sidebar.addEventListener('click', (e) => {
        if (e.target.closest('a.nav-item') && window.innerWidth <= 768) {
          closeMenu();
        }
      });
    }

    // Fecha ao redimensionar para desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeMenu();
    });

    // Swipe para fechar (da direita para esquerda na sidebar)
    setupSwipeToClose(sidebar);
  }

  // ===== SWIPE TO CLOSE =====
  function setupSwipeToClose(sidebar) {
    if (!sidebar) return;
    let startX = 0;
    let startY = 0;

    sidebar.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    sidebar.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = Math.abs(e.changedTouches[0].clientY - startY);
      // Swipe horizontal > 60px e mais horizontal que vertical
      if (dx < -60 && dy < 80) closeMenu();
    }, { passive: true });
  }

  // ===== ABRIR / FECHAR =====
  function toggleMenu() {
    const btn = document.getElementById('hamburger-btn');
    btn?.classList.contains('open') ? closeMenu() : openMenu();
  }

  function openMenu() {
    document.getElementById('hamburger-btn')?.classList.add('open');
    document.getElementById('hamburger-btn')?.setAttribute('aria-expanded', 'true');
    document.getElementById('sidebar-overlay')?.classList.add('active');
    document.getElementById('sidebar-container')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    document.getElementById('hamburger-btn')?.classList.remove('open');
    document.getElementById('hamburger-btn')?.setAttribute('aria-expanded', 'false');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
    document.getElementById('sidebar-container')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  window.mobileMenu = { open: openMenu, close: closeMenu };
})();

window.addEventListener('load', () => {
  addCollapseExpandHandling();
});

function addCollapseExpandHandling() {
  document.querySelectorAll('[data-cs-type="collapsible-header"]').forEach((header) => {
    header.addEventListener('click', () => {
      const title = header.getAttribute('data-cs-title');
      const container = document.querySelector(`[data-cs-type="collapsible-container"][data-cs-title="${title}"]`);
      if (!container) return;
      header.firstElementChild?.classList.toggle('rotated');
      container.classList.toggle('collapsed');
    });
  });
}

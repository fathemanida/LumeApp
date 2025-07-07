document.addEventListener('DOMContentLoaded', function() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  const sidebarToggle = document.getElementById('sidebarToggle');

  if (sidebarToggle && sidebar && overlay) {
    sidebarToggle.addEventListener('click', function() {
      sidebar.classList.add('open');
      overlay.classList.add('active');
    });

    overlay.addEventListener('click', function() {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  // Open the first sidebar section by default
  const firstItems = document.querySelectorAll('.sidebar-category .sidebar-items');
  if (firstItems.length > 0) {
    firstItems[0].classList.add('open');
  }
});

window.toggleCategory = function(element) {
  const items = element.nextElementSibling;
  const icon = element.querySelector('i');
  items.classList.toggle('open');
  if (items.classList.contains('open')) {
    icon.classList.remove('fa-chevron-down');
    icon.classList.add('fa-chevron-up');
  } else {
    icon.classList.remove('fa-chevron-up');
    icon.classList.add('fa-chevron-down');
  }
} 
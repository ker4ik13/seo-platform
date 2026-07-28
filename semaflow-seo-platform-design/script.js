document.addEventListener("DOMContentLoaded", () => {
  const views = [...document.querySelectorAll("[data-view]")];
  const viewLinks = [...document.querySelectorAll("[data-view-link]")];
  const sidebar = document.querySelector("[data-sidebar]");
  const projectPopover = document.querySelector("[data-project-popover]");
  const toast = document.querySelector("[data-toast]");
  let toastTimer;

  const showToast = (message) => {
    if (!toast) return;
    toast.querySelector("span").textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
  };

  const activateView = (name, updateHash = true) => {
    const target = views.find((view) => view.dataset.view === name);
    if (!target) return;
    views.forEach((view) => view.classList.toggle("is-active", view === target));
    viewLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.viewLink === name));
    if (updateHash) history.replaceState(null, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: "instant" });
    sidebar?.classList.remove("is-open");
  };

  viewLinks.forEach((link) => {
    link.addEventListener("click", () => activateView(link.dataset.viewLink));
  });

  const initialView = location.hash.replace("#", "");
  activateView(views.some((view) => view.dataset.view === initialView) ? initialView : "dashboard", false);

  document.querySelector("[data-sidebar-toggle]")?.addEventListener("click", () => {
    sidebar?.classList.toggle("is-open");
  });

  document.querySelector("[data-project-menu]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    projectPopover?.classList.toggle("is-open");
  });
  projectPopover?.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => projectPopover?.classList.remove("is-open"));

  document.querySelectorAll(".project-option").forEach((option) => {
    option.addEventListener("click", () => {
      document.querySelectorAll(".project-option").forEach((item) => item.classList.remove("is-active"));
      option.classList.add("is-active");
      projectPopover?.classList.remove("is-open");
      showToast(`Проект «${option.querySelector("b")?.textContent}» выбран`);
    });
  });

  const openModal = (name) => {
    const modal = document.querySelector(`[data-modal="${name}"]`);
    modal?.classList.add("is-open");
    modal?.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  };
  const closeModal = (modal) => {
    modal?.classList.remove("is-open");
    modal?.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal.is-open, .drawer.is-open")) document.body.classList.remove("modal-open");
  };
  document.querySelectorAll("[data-modal-open]").forEach((button) => {
    button.addEventListener("click", () => openModal(button.dataset.modalOpen));
  });
  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.closest(".modal")));
  });

  const openDrawer = (name) => {
    const drawer = document.querySelector(`[data-drawer="${name}"]`);
    drawer?.classList.add("is-open");
    drawer?.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  };
  const closeDrawer = (drawer) => {
    drawer?.classList.remove("is-open");
    drawer?.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal.is-open, .drawer.is-open")) document.body.classList.remove("modal-open");
  };
  document.querySelectorAll("[data-drawer-open]").forEach((button) => {
    button.addEventListener("click", () => openDrawer(button.dataset.drawerOpen));
  });
  document.querySelectorAll("[data-drawer-close]").forEach((button) => {
    button.addEventListener("click", () => closeDrawer(button.closest(".drawer")));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal.is-open").forEach(closeModal);
    document.querySelectorAll(".drawer.is-open").forEach(closeDrawer);
    projectPopover?.classList.remove("is-open");
  });

  document.querySelectorAll("[data-start-demo]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(button.closest(".modal"));
      showToast("Задача добавлена в очередь");
    });
  });
  document.querySelectorAll("[data-save-demo]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(button.closest(".modal"));
      showToast("Настройки сохранены");
    });
  });

  document.querySelectorAll(".segmented button, .engine-tabs button, .quick-actions button, .import-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      const parent = button.parentElement;
      parent?.querySelectorAll("button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
    });
  });

  document.querySelectorAll(".star").forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.toggle("is-active");
      button.textContent = button.classList.contains("is-active") ? "★" : "☆";
    });
  });

  const rowChecks = [...document.querySelectorAll("[data-row-check]")];
  const selectAll = document.querySelector("[data-select-all]");
  const bulkBar = document.querySelector("[data-bulk-bar]");
  const updateBulkSelection = () => {
    const count = rowChecks.filter((input) => input.checked).length;
    bulkBar?.classList.toggle("is-hidden", count === 0);
    const counter = bulkBar?.querySelector("span b");
    if (counter) counter.textContent = String(count);
    rowChecks.forEach((input) => input.closest("tr")?.classList.toggle("is-selected", input.checked));
    if (selectAll) {
      selectAll.checked = count === rowChecks.length;
      selectAll.indeterminate = count > 0 && count < rowChecks.length;
    }
  };
  rowChecks.forEach((input) => input.addEventListener("change", updateBulkSelection));
  selectAll?.addEventListener("change", () => {
    rowChecks.forEach((input) => { input.checked = selectAll.checked; });
    updateBulkSelection();
  });
  document.querySelector("[data-clear-selection]")?.addEventListener("click", () => {
    rowChecks.forEach((input) => { input.checked = false; });
    updateBulkSelection();
  });
  updateBulkSelection();

  document.querySelector("[data-edit-dashboard]")?.addEventListener("click", () => {
    showToast("Режим настройки дашборда включён");
  });
});

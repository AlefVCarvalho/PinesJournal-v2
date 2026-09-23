import { api } from "./api.js";

const THEMES = {
  Vinho: { accent: "#8d2141", header: "#6b1733" },
  Azul: { accent: "#3f6f9f", header: "#24496d" },
  Verde: { accent: "#4f7b62", header: "#315b45" },
  Grafite: { accent: "#555962", header: "#303238" },
};

const STATUS_OPTIONS = [
  ["all", "Todas"],
  ["pending", "Pendentes"],
  ["completed", "Concluídas"],
  ["overdue", "Atrasadas"],
  ["no-date", "Sem data"],
];

const state = {
  tasks: [],
  tags: [],
  view: "tasks",
  search: "",
  sort: "default",
  filters: { status: "all", tagIds: new Set(), withoutTags: false },
  draftFilters: { status: "all", tagIds: new Set(), withoutTags: false },
  calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDate: null,
  installPrompt: null,
  notificationConfig: null,
  pushSubscription: null,
  notificationBusy: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  taskList: $("#taskList"),
  searchInput: $("#searchInput"),
  sortSelect: $("#sortSelect"),
  filterButton: $("#filterButton"),
  overdueBanner: $("#overdueBanner"),
  activeFilters: $("#activeFilters"),
  taskDialog: $("#taskDialog"),
  taskForm: $("#taskForm"),
  taskId: $("#taskId"),
  taskTitle: $("#taskTitle"),
  taskDescription: $("#taskDescription"),
  taskDueDate: $("#taskDueDate"),
  taskTagChoices: $("#taskTagChoices"),
  taskDialogTitle: $("#taskDialogTitle"),
  deleteTaskButton: $("#deleteTaskButton"),
  filterDialog: $("#filterDialog"),
  statusChoices: $("#statusChoices"),
  filterTagChoices: $("#filterTagChoices"),
  withoutTagsFilter: $("#withoutTagsFilter"),
  tagDialog: $("#tagDialog"),
  tagForm: $("#tagForm"),
  newTagName: $("#newTagName"),
  newTagColor: $("#newTagColor"),
  tagManagerList: $("#tagManagerList"),
  toast: $("#toast"),
  apiStatus: $("#apiStatus"),
  apiStatusDot: $("#apiStatusDot"),
  calendarTitle: $("#calendarTitle"),
  calendarGrid: $("#calendarGrid"),
  selectedDayTitle: $("#selectedDayTitle"),
  selectedDayTasks: $("#selectedDayTasks"),
  themeOptions: $("#themeOptions"),
  installButton: $("#installButton"),
  settingsInstallButton: $("#settingsInstallButton"),
  notificationStateBadge: $("#notificationStateBadge"),
  notificationStatusText: $("#notificationStatusText"),
  notificationTime: $("#notificationTime"),
  enableNotificationsButton: $("#enableNotificationsButton"),
  testNotificationButton: $("#testNotificationButton"),
  disableNotificationsButton: $("#disableNotificationsButton"),
  badgeSupportText: $("#badgeSupportText"),
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function localDateFromIso(isoDate) {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDate(isoDate) {
  const date = localDateFromIso(isoDate);
  if (!date) return "";
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function formatLongDate(isoDate) {
  const date = localDateFromIso(isoDate);
  if (!date) return "";
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function isOverdue(task) {
  return !task.completed && task.due_date && task.due_date < toIsoDate(new Date());
}

function contrastText(hex) {
  const clean = String(hex || "#888888").replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 165 ? "#202020" : "#ffffff";
}

let toastTimer = null;
function toast(message, type = "normal") {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("error", type === "error");
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function setApiStatus(online, label = null) {
  els.apiStatusDot.classList.toggle("online", online);
  els.apiStatusDot.classList.toggle("offline", !online);
  els.apiStatus.textContent = label || (online ? "online" : "sem conexão");
}

async function loadData({ quiet = false } = {}) {
  try {
    const [taskData, tagData] = await Promise.all([api.tasks(), api.tags()]);
    state.tasks = taskData.items || [];
    state.tags = tagData.items || [];
    setApiStatus(true);
    renderAll();
    void updateAppBadge();
  } catch (error) {
    setApiStatus(false);
    renderTasks();
    if (!quiet) toast(`Não foi possível carregar os dados: ${error.message}`, "error");
  }
}

function renderAll() {
  renderTasks();
  renderCalendar();
  renderTagManager();
  renderTaskTagChoices();
  renderThemeOptions();
}

function filteredTasks() {
  let tasks = [...state.tasks];
  const terms = normalizeText(state.search).split(/\s+/).filter(Boolean);
  const today = toIsoDate(new Date());

  if (terms.length) {
    tasks = tasks.filter((task) => {
      const tagNames = (task.tags || []).map((tag) => tag.name).join(" ");
      const haystack = normalizeText([
        task.title,
        task.description,
        task.due_date ? formatDate(task.due_date) : "",
        task.due_date || "",
        tagNames,
      ].join(" "));
      return terms.every((term) => haystack.includes(term));
    });
  }

  const status = state.filters.status;
  if (status === "pending") tasks = tasks.filter((task) => !task.completed);
  if (status === "completed") tasks = tasks.filter((task) => task.completed);
  if (status === "overdue") tasks = tasks.filter((task) => !task.completed && task.due_date && task.due_date < today);
  if (status === "no-date") tasks = tasks.filter((task) => !task.due_date);

  if (state.filters.withoutTags) {
    tasks = tasks.filter((task) => !(task.tags || []).length);
  } else if (state.filters.tagIds.size) {
    tasks = tasks.filter((task) => {
      const ids = new Set((task.tags || []).map((tag) => tag.id));
      return [...state.filters.tagIds].every((id) => ids.has(id));
    });
  }

  return sortTasks(tasks);
}

function sortTasks(tasks) {
  const option = state.sort;
  const created = (task) => task.created_at || "";
  if (option === "due-asc") return tasks.sort((a, b) => (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") || created(b).localeCompare(created(a)));
  if (option === "due-desc") {
    const dated = tasks.filter((task) => task.due_date).sort((a, b) => b.due_date.localeCompare(a.due_date));
    return [...dated, ...tasks.filter((task) => !task.due_date)];
  }
  if (option === "created-desc") return tasks.sort((a, b) => created(b).localeCompare(created(a)));
  if (option === "created-asc") return tasks.sort((a, b) => created(a).localeCompare(created(b)));
  if (option === "title-asc") return tasks.sort((a, b) => normalizeText(a.title).localeCompare(normalizeText(b.title), "pt-BR"));
  if (option === "title-desc") return tasks.sort((a, b) => normalizeText(b.title).localeCompare(normalizeText(a.title), "pt-BR"));
  return tasks;
}

function tagMarkup(tag) {
  const color = tag.color || "#8d2141";
  return `<span class="tag-pill" style="background:${escapeHtml(color)};color:${contrastText(color)}">${escapeHtml(tag.name)}</span>`;
}

function taskCardMarkup(task) {
  const dueClass = isOverdue(task) ? "overdue" : "";
  const due = task.due_date ? `<span class="due-label ${dueClass}">${isOverdue(task) ? "Atrasada · " : ""}${formatDate(task.due_date)}</span>` : `<span class="due-label">Sem prazo</span>`;
  const tags = (task.tags || []).map(tagMarkup).join("");
  const description = task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : "";
  return `
    <article class="task-card ${task.completed ? "completed" : ""}" data-task-id="${escapeHtml(task.id)}">
      <input class="task-check" type="checkbox" ${task.completed ? "checked" : ""} aria-label="${task.completed ? "Reabrir" : "Concluir"} ${escapeHtml(task.title)}">
      <div>
        <p class="task-title">${escapeHtml(task.title)}</p>
        ${description}
        <div class="task-meta">${due}${tags}</div>
      </div>
      <span class="task-chevron">›</span>
    </article>`;
}

function renderTasks() {
  const tasks = filteredTasks();
  const pending = tasks.filter((task) => !task.completed);
  const completed = tasks.filter((task) => task.completed);
  const overdueCount = state.tasks.filter(isOverdue).length;

  els.overdueBanner.hidden = overdueCount === 0;
  if (overdueCount) els.overdueBanner.textContent = `⚠ ${overdueCount} tarefa${overdueCount === 1 ? "" : "s"} atrasada${overdueCount === 1 ? "" : "s"}.`;

  const activeCount = (state.filters.status !== "all" ? 1 : 0) + state.filters.tagIds.size + (state.filters.withoutTags ? 1 : 0);
  els.filterButton.textContent = activeCount ? `Filtros (${activeCount})` : "Filtros";
  renderActiveFilters();

  if (!tasks.length) {
    const noCriteria = !state.search.trim() && state.filters.status === "all" && !state.filters.tagIds.size && !state.filters.withoutTags;
    els.taskList.innerHTML = `<div class="empty-state"><strong>${noCriteria ? "Seu bloco está vazio" : "Nenhuma tarefa encontrada"}</strong>${noCriteria ? "Use + Tarefa para criar a primeira tarefa." : "Tente alterar a pesquisa ou os filtros."}</div>`;
    bindTaskCards();
    return;
  }

  const section = (title, items) => items.length ? `<section class="task-section"><div class="section-label">${title}<span class="section-count">${items.length}</span></div>${items.map(taskCardMarkup).join("")}</section>` : "";
  els.taskList.innerHTML = section("Pendentes", pending) + section("Concluídas", completed);
  bindTaskCards();
}

function renderActiveFilters() {
  const chips = [];
  if (state.filters.status !== "all") {
    const label = STATUS_OPTIONS.find(([id]) => id === state.filters.status)?.[1];
    chips.push(`Status: ${label}`);
  }
  if (state.filters.withoutTags) chips.push("Sem tag");
  else {
    for (const id of state.filters.tagIds) {
      const tag = state.tags.find((item) => item.id === id);
      if (tag) chips.push(`Tag: ${tag.name}`);
    }
  }
  els.activeFilters.hidden = chips.length === 0;
  els.activeFilters.innerHTML = chips.map((chip) => `<span class="filter-chip">${escapeHtml(chip)}</span>`).join("");
}

function bindTaskCards() {
  $$(".task-card").forEach((card) => {
    const id = card.dataset.taskId;
    card.addEventListener("click", (event) => {
      if (event.target.classList.contains("task-check")) return;
      openTaskDialog(id);
    });
    card.querySelector(".task-check")?.addEventListener("change", async (event) => {
      event.stopPropagation();
      try {
        await api.setCompleted(id, event.target.checked);
        await loadData({ quiet: true });
      } catch (error) {
        event.target.checked = !event.target.checked;
        toast(error.message, "error");
      }
    });
  });
}

function renderTaskTagChoices(selectedIds = new Set()) {
  if (!state.tags.length) {
    els.taskTagChoices.innerHTML = `<span class="muted">Nenhuma tag criada.</span>`;
    return;
  }
  els.taskTagChoices.innerHTML = state.tags.map((tag) => `
    <label class="tag-choice">
      <input type="checkbox" value="${escapeHtml(tag.id)}" ${selectedIds.has(tag.id) ? "checked" : ""}>
      <span class="tag-dot" style="background:${escapeHtml(tag.color)}"></span>
      ${escapeHtml(tag.name)}
    </label>`).join("");
}

function openTaskDialog(taskId = null, presetDate = null) {
  const task = taskId ? state.tasks.find((item) => item.id === taskId) : null;
  els.taskId.value = task?.id || "";
  els.taskTitle.value = task?.title || "";
  els.taskDescription.value = task?.description || "";
  els.taskDueDate.value = task?.due_date || presetDate || "";
  els.taskDialogTitle.textContent = task ? "Editar tarefa" : "Nova tarefa";
  els.deleteTaskButton.hidden = !task;
  renderTaskTagChoices(new Set((task?.tags || []).map((tag) => tag.id)));
  els.taskDialog.showModal();
  setTimeout(() => els.taskTitle.focus(), 30);
}

async function saveTask(event) {
  event.preventDefault();
  const payload = {
    title: els.taskTitle.value.trim(),
    description: els.taskDescription.value.trim(),
    due_date: els.taskDueDate.value || null,
    tag_ids: $$("#taskTagChoices input:checked").map((input) => input.value),
  };
  if (!payload.title) return;

  try {
    const id = els.taskId.value;
    if (id) await api.updateTask(id, payload);
    else await api.createTask(payload);
    els.taskDialog.close();
    await loadData({ quiet: true });
    toast(id ? "Tarefa atualizada." : "Tarefa criada.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteCurrentTask() {
  const id = els.taskId.value;
  if (!id) return;
  const task = state.tasks.find((item) => item.id === id);
  if (!confirm(`Excluir a tarefa “${task?.title || ""}”?`)) return;
  try {
    await api.deleteTask(id);
    els.taskDialog.close();
    await loadData({ quiet: true });
    toast("Tarefa excluída.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderFilterForm() {
  els.statusChoices.innerHTML = STATUS_OPTIONS.map(([id, label]) => `<label class="radio-row"><input type="radio" name="task-status" value="${id}" ${state.draftFilters.status === id ? "checked" : ""}> ${label}</label>`).join("");
  els.withoutTagsFilter.checked = state.draftFilters.withoutTags;
  els.filterTagChoices.innerHTML = state.tags.length
    ? state.tags.map((tag) => `<label class="check-row"><input type="checkbox" value="${escapeHtml(tag.id)}" ${state.draftFilters.tagIds.has(tag.id) ? "checked" : ""}><span class="tag-dot" style="background:${escapeHtml(tag.color)}"></span>${escapeHtml(tag.name)}</label>`).join("")
    : `<span class="muted">Nenhuma tag criada.</span>`;
  els.filterTagChoices.querySelectorAll("input").forEach((input) => { input.disabled = els.withoutTagsFilter.checked; });
}

function openFilters() {
  state.draftFilters = {
    status: state.filters.status,
    tagIds: new Set(state.filters.tagIds),
    withoutTags: state.filters.withoutTags,
  };
  renderFilterForm();
  els.filterDialog.showModal();
}

function applyFilters(event) {
  event.preventDefault();
  const checkedStatus = $('#statusChoices input[name="task-status"]:checked');
  state.filters = {
    status: checkedStatus?.value || "all",
    tagIds: new Set($$("#filterTagChoices input:checked").map((input) => input.value)),
    withoutTags: els.withoutTagsFilter.checked,
  };
  els.filterDialog.close();
  renderTasks();
}

function clearFilters() {
  state.draftFilters = { status: "all", tagIds: new Set(), withoutTags: false };
  renderFilterForm();
}

function renderTagManager() {
  if (!state.tags.length) {
    els.tagManagerList.innerHTML = `<div class="empty-state"><strong>Nenhuma tag</strong>Crie uma tag para organizar suas tarefas.</div>`;
    return;
  }
  els.tagManagerList.innerHTML = state.tags.map((tag) => `
    <div class="tag-manager-row">
      <span class="tag-dot" style="background:${escapeHtml(tag.color)}"></span>
      <span>${escapeHtml(tag.name)}</span>
      <button type="button" data-delete-tag="${escapeHtml(tag.id)}">Excluir</button>
    </div>`).join("");

  $$('[data-delete-tag]').forEach((button) => button.addEventListener("click", async () => {
    const tag = state.tags.find((item) => item.id === button.dataset.deleteTag);
    if (!confirm(`Excluir a tag “${tag?.name || ""}”? Ela será removida das tarefas existentes.`)) return;
    try {
      await api.deleteTag(button.dataset.deleteTag);
      state.filters.tagIds.delete(button.dataset.deleteTag);
      await loadData({ quiet: true });
      toast("Tag excluída.");
    } catch (error) {
      toast(error.message, "error");
    }
  }));
}

async function createTag(event) {
  event.preventDefault();
  const name = els.newTagName.value.trim();
  if (!name) return;
  try {
    await api.createTag({ name, color: els.newTagColor.value });
    els.newTagName.value = "";
    await loadData({ quiet: true });
    toast("Tag criada.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function setView(view) {
  if (state.view === "scratch" && view !== "scratch") commitScratchText();
  state.view = view;
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  $$('[data-view]').forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "calendar") renderCalendar();
  if (view === "scratch") resizeScratchCanvas();
}

function tasksForDate(isoDate) {
  return state.tasks.filter((task) => task.due_date === isoDate);
}

function renderCalendar() {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  els.calendarTitle.textContent = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(state.calendarDate);

  const first = new Date(year, month, 1);
  const start = new Date(first);
  const weekday = first.getDay();
  start.setDate(first.getDate() - weekday);
  const todayIso = toIsoDate(new Date());
  const cells = [];

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = toIsoDate(date);
    const tasks = tasksForDate(iso);
    const pending = tasks.filter((task) => !task.completed).length;
    cells.push(`
      <button class="calendar-day ${date.getMonth() !== month ? "outside" : ""} ${iso === todayIso ? "today" : ""} ${state.selectedDate === iso ? "selected" : ""}" data-calendar-date="${iso}">
        <span class="day-number">${date.getDate()}</span>
        ${tasks.length ? `<span class="day-count ${pending ? "pending" : ""}">${tasks.length} tarefa${tasks.length === 1 ? "" : "s"}${pending ? ` · ${pending} pend.` : ""}</span>` : ""}
      </button>`);
  }
  els.calendarGrid.innerHTML = cells.join("");
  $$('[data-calendar-date]').forEach((button) => button.addEventListener("click", () => selectCalendarDate(button.dataset.calendarDate)));
  renderSelectedDay();
}

function selectCalendarDate(isoDate) {
  state.selectedDate = isoDate;
  const date = localDateFromIso(isoDate);
  state.calendarDate = new Date(date.getFullYear(), date.getMonth(), 1);
  renderCalendar();
}

function renderSelectedDay() {
  if (!state.selectedDate) {
    els.selectedDayTitle.textContent = "Selecione um dia";
    els.selectedDayTasks.innerHTML = `<p class="muted">As tarefas com prazo aparecerão aqui.</p>`;
    return;
  }
  const tasks = tasksForDate(state.selectedDate);
  els.selectedDayTitle.textContent = formatLongDate(state.selectedDate);
  if (!tasks.length) {
    els.selectedDayTasks.innerHTML = `<p class="muted">Nenhuma tarefa com prazo neste dia.</p><button class="button secondary" id="addTaskForDay">+ Criar tarefa</button>`;
  } else {
    els.selectedDayTasks.innerHTML = tasks.map((task) => `<div class="compact-task ${task.completed ? "completed" : ""}" data-day-task="${escapeHtml(task.id)}"><strong>${escapeHtml(task.title)}</strong>${task.description ? `<div class="muted">${escapeHtml(task.description)}</div>` : ""}</div>`).join("") + `<button class="button secondary" id="addTaskForDay">+ Criar tarefa</button>`;
  }
  $$('[data-day-task]').forEach((item) => item.addEventListener("click", () => openTaskDialog(item.dataset.dayTask)));
  $("#addTaskForDay")?.addEventListener("click", () => openTaskDialog(null, state.selectedDate));
}

function renderThemeOptions() {
  const current = localStorage.getItem("pinesjournal-theme") || "Vinho";
  els.themeOptions.innerHTML = Object.entries(THEMES).map(([name, theme]) => `
    <button class="theme-option ${current === name ? "active" : ""}" data-theme-option="${name}">
      <span class="theme-swatch" style="background:${theme.header}"></span><span>${name}</span>
    </button>`).join("");
  $$('[data-theme-option]').forEach((button) => button.addEventListener("click", () => setTheme(button.dataset.themeOption)));
}

function setTheme(theme) {
  if (!THEMES[theme]) return;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("pinesjournal-theme", theme);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", THEMES[theme].header);
  renderThemeOptions();
}

async function installApp() {
  if (!state.installPrompt) {
    toast("Use o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.");
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  els.installButton.hidden = true;
}

function supportsPushNotifications() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function sameApplicationServerKey(subscription, expectedKey) {
  const current = subscription?.options?.applicationServerKey;
  if (!current) return true;
  const currentBytes = new Uint8Array(current);
  if (currentBytes.length !== expectedKey.length) return false;
  return currentBytes.every((value, index) => value === expectedKey[index]);
}

function notificationEnvironment() {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    utc_offset_minutes: -new Date().getTimezoneOffset(),
  };
}

function subscriptionPayload(subscription) {
  const json = subscription.toJSON();
  const environment = notificationEnvironment();
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh || "",
      auth: json.keys?.auth || "",
    },
    timezone: environment.timezone,
    utc_offset_minutes: environment.utc_offset_minutes,
    notify_time: els.notificationTime.value || "09:00",
  };
}

function setNotificationBusy(busy) {
  state.notificationBusy = busy;
  const configured = Boolean(state.notificationConfig?.available && state.notificationConfig?.public_key);
  els.enableNotificationsButton.disabled = busy || !supportsPushNotifications() || !configured || Notification.permission === "denied";
  els.testNotificationButton.disabled = busy;
  els.disableNotificationsButton.disabled = busy;
  els.notificationTime.disabled = busy || !state.pushSubscription;
}

function setNotificationUi({ enabled = false, stateLabel = "Desativadas", statusText = "", canEnable = true } = {}) {
  els.notificationStateBadge.textContent = stateLabel;
  els.notificationStateBadge.classList.toggle("active", enabled);
  els.notificationStatusText.textContent = statusText;
  els.enableNotificationsButton.hidden = enabled;
  els.testNotificationButton.hidden = !enabled;
  els.disableNotificationsButton.hidden = !enabled;
  els.enableNotificationsButton.disabled = state.notificationBusy || !canEnable;
  els.notificationTime.disabled = state.notificationBusy || !enabled;
}

function updateBadgeSupportLabel() {
  if ("setAppBadge" in navigator && "clearAppBadge" in navigator) {
    els.badgeSupportText.textContent = "Contagem ativa";
    return;
  }
  if (supportsPushNotifications()) {
    els.badgeSupportText.textContent = "Gerenciado pelo sistema";
    return;
  }
  els.badgeSupportText.textContent = "Não suportado";
}

async function updateAppBadge() {
  if (!("setAppBadge" in navigator) || !("clearAppBadge" in navigator)) return;
  const pendingCount = state.tasks.filter((task) => !task.completed).length;
  try {
    if (pendingCount > 0) await navigator.setAppBadge(pendingCount);
    else await navigator.clearAppBadge();
  } catch {
    // Alguns sistemas só aceitam badges quando a PWA está instalada.
  }
}

async function refreshNotificationSettings() {
  updateBadgeSupportLabel();
  if (!supportsPushNotifications()) {
    setNotificationUi({
      stateLabel: "Indisponíveis",
      statusText: "Este navegador não oferece notificações push para esta PWA.",
      canEnable: false,
    });
    return;
  }

  try {
    const config = await api.notificationConfig();
    state.notificationConfig = config;
    if (!config.available || !config.public_key) {
      setNotificationUi({
        stateLabel: "Configuração pendente",
        statusText: "As notificações ainda precisam ser ativadas no servidor.",
        canEnable: false,
      });
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    state.pushSubscription = subscription;

    if (!subscription) {
      const denied = Notification.permission === "denied";
      setNotificationUi({
        stateLabel: denied ? "Bloqueadas" : "Desativadas",
        statusText: denied
          ? "As notificações estão bloqueadas nas permissões do navegador."
          : "Receba um resumo diário somente quando houver tarefas para hoje ou atrasadas.",
        canEnable: !denied,
      });
      return;
    }

    const serverState = await api.notificationStatus(subscription.endpoint);
    if (serverState.subscription?.notify_time) {
      els.notificationTime.value = serverState.subscription.notify_time;
    }

    if (!serverState.enabled) {
      const repaired = await api.subscribeNotifications(subscriptionPayload(subscription));
      if (repaired?.notify_time) els.notificationTime.value = repaired.notify_time;
    } else {
      const environment = notificationEnvironment();
      if (serverState.subscription.timezone !== environment.timezone || Number(serverState.subscription.utc_offset_minutes) !== environment.utc_offset_minutes) {
        await api.updateNotificationPreferences({
          endpoint: subscription.endpoint,
          notify_time: els.notificationTime.value || "09:00",
          timezone: environment.timezone,
          utc_offset_minutes: environment.utc_offset_minutes,
        });
      }
    }

    setNotificationUi({
      enabled: true,
      stateLabel: "Ativas",
      statusText: "Resumo diário para tarefas de hoje e atrasadas.",
    });
  } catch (error) {
    setNotificationUi({
      stateLabel: "Erro",
      statusText: "Não foi possível conferir as notificações neste momento.",
      canEnable: false,
    });
    console.error("Falha ao carregar notificações", error);
  }
}

async function enableNotifications() {
  if (state.notificationBusy || !supportsPushNotifications()) return;
  setNotificationBusy(true);
  try {
    const config = state.notificationConfig || await api.notificationConfig();
    state.notificationConfig = config;
    if (!config.available || !config.public_key) throw new Error("As notificações ainda não estão configuradas no servidor.");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(permission === "denied" ? "Permissão de notificações bloqueada no navegador." : "Permissão de notificações não concedida.");
    }

    const registration = await navigator.serviceWorker.ready;
    const expectedKey = urlBase64ToUint8Array(config.public_key);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameApplicationServerKey(subscription, expectedKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expectedKey,
      });
    }

    const saved = await api.subscribeNotifications(subscriptionPayload(subscription));
    state.pushSubscription = subscription;
    if (saved?.notify_time) els.notificationTime.value = saved.notify_time;
    setNotificationUi({ enabled: true, stateLabel: "Ativas", statusText: "Resumo diário para tarefas de hoje e atrasadas." });
    toast("Notificações ativadas neste dispositivo.");
  } catch (error) {
    toast(error.message, "error");
    await refreshNotificationSettings();
  } finally {
    setNotificationBusy(false);
  }
}

async function disableNotifications() {
  if (state.notificationBusy) return;
  setNotificationBusy(true);
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      try { await api.unsubscribeNotifications(subscription.endpoint); } catch { /* remove local mesmo se API falhar */ }
      await subscription.unsubscribe();
    }
    state.pushSubscription = null;
    setNotificationUi({
      enabled: false,
      stateLabel: "Desativadas",
      statusText: "Receba um resumo diário somente quando houver tarefas para hoje ou atrasadas.",
    });
    toast("Notificações desativadas neste dispositivo.");
  } catch (error) {
    toast(`Não foi possível desativar: ${error.message}`, "error");
  } finally {
    setNotificationBusy(false);
  }
}

async function saveNotificationTime() {
  if (state.notificationBusy || !state.pushSubscription) return;
  setNotificationBusy(true);
  try {
    const environment = notificationEnvironment();
    await api.updateNotificationPreferences({
      endpoint: state.pushSubscription.endpoint,
      notify_time: els.notificationTime.value || "09:00",
      timezone: environment.timezone,
      utc_offset_minutes: environment.utc_offset_minutes,
    });
    toast(`Horário salvo: ${els.notificationTime.value}.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setNotificationBusy(false);
  }
}

async function testNotification() {
  if (state.notificationBusy) return;
  setNotificationBusy(true);
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) throw new Error("Ative as notificações primeiro.");
    await api.testNotification(subscription.endpoint);
    toast("Notificação de teste enviada.");
  } catch (error) {
    toast(error.message, "error");
    if (/expirou/i.test(error.message)) await refreshNotificationSettings();
  } finally {
    setNotificationBusy(false);
  }
}

// Bloco de notas: salvo localmente no navegador.
const canvas = $("#scratchCanvas");
const ctx = canvas.getContext("2d");
const scratchSize = $("#scratchSize");
const scratchSizeLabel = $("#scratchSizeLabel");
let drawing = false;
let scratchTool = "draw";
let lastPoint = null;
let restoringScratch = false;
let scratchBrushSize = Number(scratchSize.value);
let scratchTextSize = 20;
let scratchTextInput = null;
let scratchTextPoint = null;

function saveScratch() {
  try { localStorage.setItem("pinesjournal-scratch", canvas.toDataURL("image/png")); } catch { /* armazenamento cheio */ }
}

function setScratchTool(tool) {
  if (scratchTool === "text") scratchTextSize = Number(scratchSize.value);
  else scratchBrushSize = Number(scratchSize.value);
  if (scratchTextInput) commitScratchText();

  scratchTool = tool;
  const textMode = tool === "text";
  scratchSizeLabel.textContent = textMode ? "Tamanho" : "Espessura";
  scratchSize.min = textMode ? "12" : "2";
  scratchSize.max = textMode ? "48" : "28";
  scratchSize.value = String(textMode ? scratchTextSize : scratchBrushSize);
  canvas.classList.toggle("text-tool", textMode);
  $$(".tool-button").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
}

function resizeScratchCanvas() {
  if (state.view !== "scratch") return;
  if (scratchTextInput) commitScratchText();
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const saved = localStorage.getItem("pinesjournal-scratch");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#fffef8";
  ctx.fillRect(0, 0, rect.width, rect.height);
  if (saved && !restoringScratch) {
    restoringScratch = true;
    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, 0, 0, rect.width, rect.height);
      restoringScratch = false;
    };
    image.onerror = () => { restoringScratch = false; };
    image.src = saved;
  }
}

function scratchPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function beginScratchText(point) {
  if (scratchTextInput) commitScratchText();
  const wrap = canvas.closest(".scratch-canvas-wrap");
  const rect = canvas.getBoundingClientRect();
  const fontSize = Number(scratchSize.value);
  const left = Math.max(8, Math.min(point.x, Math.max(8, rect.width - 196)));
  const top = Math.max(8, Math.min(point.y, Math.max(8, rect.height - 42)));

  const input = document.createElement("input");
  input.type = "text";
  input.className = "scratch-text-input";
  input.placeholder = "Digite o texto";
  input.style.left = `${left}px`;
  input.style.top = `${top}px`;
  input.style.fontSize = `${fontSize}px`;
  wrap.appendChild(input);
  scratchTextInput = input;
  scratchTextPoint = { x: left, y: top, size: fontSize };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitScratchText();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelScratchText();
    }
  });
  input.addEventListener("blur", () => commitScratchText());
  input.focus();
}

function commitScratchText() {
  if (!scratchTextInput) return;
  const input = scratchTextInput;
  const point = scratchTextPoint;
  const value = input.value.trim();
  scratchTextInput = null;
  scratchTextPoint = null;
  input.remove();
  if (!value || !point) return;

  ctx.save();
  ctx.fillStyle = $("#scratchColor").value;
  ctx.font = `${point.size}px Inter, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(value, point.x, point.y);
  ctx.restore();
  saveScratch();
}

function cancelScratchText() {
  if (!scratchTextInput) return;
  const input = scratchTextInput;
  scratchTextInput = null;
  scratchTextPoint = null;
  input.remove();
}

function startScratch(event) {
  const point = scratchPoint(event);
  if (scratchTool === "text") {
    beginScratchText(point);
    event.preventDefault();
    return;
  }
  drawing = true;
  lastPoint = point;
  event.preventDefault();
}

function moveScratch(event) {
  if (!drawing || !lastPoint || scratchTool === "text") return;
  const point = scratchPoint(event);
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(point.x, point.y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Number(scratchSize.value);
  ctx.strokeStyle = scratchTool === "erase" ? "#fffef8" : $("#scratchColor").value;
  ctx.stroke();
  lastPoint = point;
  event.preventDefault();
}

function stopScratch() {
  if (!drawing) return;
  drawing = false;
  lastPoint = null;
  saveScratch();
}

function clearScratch() {
  if (!confirm("Limpar todo o bloco deste dispositivo?")) return;
  cancelScratchText();
  localStorage.removeItem("pinesjournal-scratch");
  const rect = canvas.getBoundingClientRect();
  ctx.fillStyle = "#fffef8";
  ctx.fillRect(0, 0, rect.width, rect.height);
}

function downloadScratch() {
  commitScratchText();
  const link = document.createElement("a");
  link.download = `PinesJournal_Bloco_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function bindEvents() {
  $$(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close()));
  $$('[data-view]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $("#addTaskButton").addEventListener("click", () => openTaskDialog());
  $("#addTagButton").addEventListener("click", () => { renderTagManager(); els.tagDialog.showModal(); setTimeout(() => els.newTagName.focus(), 30); });
  els.taskForm.addEventListener("submit", saveTask);
  els.deleteTaskButton.addEventListener("click", deleteCurrentTask);
  els.tagForm.addEventListener("submit", createTag);
  els.filterButton.addEventListener("click", openFilters);
  $("#filterForm").addEventListener("submit", applyFilters);
  $("#clearFiltersButton").addEventListener("click", clearFilters);
  els.withoutTagsFilter.addEventListener("change", () => {
    els.filterTagChoices.querySelectorAll("input").forEach((input) => { input.disabled = els.withoutTagsFilter.checked; });
  });
  els.searchInput.addEventListener("input", () => { state.search = els.searchInput.value; renderTasks(); });
  els.sortSelect.addEventListener("change", () => { state.sort = els.sortSelect.value; renderTasks(); });
  $("#calendarPrev").addEventListener("click", () => { state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1); renderCalendar(); });
  $("#calendarNext").addEventListener("click", () => { state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1); renderCalendar(); });
  els.installButton.addEventListener("click", installApp);
  els.settingsInstallButton.addEventListener("click", installApp);
  els.enableNotificationsButton.addEventListener("click", enableNotifications);
  els.disableNotificationsButton.addEventListener("click", disableNotifications);
  els.testNotificationButton.addEventListener("click", testNotification);
  els.notificationTime.addEventListener("change", saveNotificationTime);

  $$(".tool-button").forEach((button) => button.addEventListener("click", () => setScratchTool(button.dataset.tool)));
  $("#clearScratchButton").addEventListener("click", clearScratch);
  $("#downloadScratchButton").addEventListener("click", downloadScratch);
  canvas.addEventListener("pointerdown", startScratch);
  canvas.addEventListener("pointermove", moveScratch);
  canvas.addEventListener("pointerup", stopScratch);
  canvas.addEventListener("pointerleave", stopScratch);
  window.addEventListener("resize", () => { if (state.view === "scratch") resizeScratchCanvas(); });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    els.installButton.hidden = false;
  });
  window.addEventListener("online", () => loadData({ quiet: true }));
  window.addEventListener("offline", () => setApiStatus(false));
}

async function boot() {
  const savedTheme = localStorage.getItem("pinesjournal-theme") || "Vinho";
  setTheme(savedTheme);
  setScratchTool("draw");
  bindEvents();
  renderFilterForm();
  renderCalendar();
  renderThemeOptions();

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/service-worker.js"); } catch { /* PWA continua funcional sem SW */ }
  }

  try {
    await api.health();
    setApiStatus(true);
  } catch {
    setApiStatus(false);
  }
  await loadData();
  await refreshNotificationSettings();
}

boot();

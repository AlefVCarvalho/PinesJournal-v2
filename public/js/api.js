let reauthenticationStarted = false;

function reauthenticate() {
  if (reauthenticationStarted) return;
  reauthenticationStarted = true;

  // O Service Worker usa network-first para navegacoes, entao o reload volta a
  // passar pelo Cloudflare Access em vez de reutilizar apenas o shell em cache.
  window.location.reload();
}

async function request(path, options = {}) {
  const { headers: optionHeaders = {}, ...rest } = options;
  const config = {
    credentials: "same-origin",
    ...rest,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...optionHeaders,
    },
  };

  const response = await fetch(path, config);

  // Cloudflare Access recomenda este fluxo para SPAs/AJAX: com
  // X-Requested-With, uma sessao expirada pode ser devolvida como 401.
  if (response.status === 401) {
    reauthenticate();
    throw new Error("Sessão expirada. Reautenticando...");
  }

  // Fallback para configuracoes em que o Access ainda devolve redirecionamento.
  if (response.redirected && response.url && !response.url.startsWith(window.location.origin)) {
    window.location.assign(response.url);
    throw new Error("Sessão expirada. Redirecionando para autenticação...");
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) throw new Error(`Erro ${response.status}`);
    throw new Error("A API retornou uma resposta inesperada. Recarregue a aplicação.");
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.detail || `Erro ${response.status}`);
  }
  return data;
}

export const api = {
  health: () => request("/api/health"),
  status: () => request("/api/status"),
  tasks: () => request("/api/tasks"),
  createTask: (payload) => request("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),
  updateTask: (id, payload) => request(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  setCompleted: (id, completed) => request(`/api/tasks/${id}/completed`, { method: "PATCH", body: JSON.stringify({ completed }) }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: "DELETE" }),
  tags: () => request("/api/tags"),
  createTag: (payload) => request("/api/tags", { method: "POST", body: JSON.stringify(payload) }),
  deleteTag: (id) => request(`/api/tags/${id}`, { method: "DELETE" }),
  notificationConfig: () => request("/api/notifications/config"),
  notificationStatus: (endpoint) => request("/api/notifications/status", { method: "POST", body: JSON.stringify({ endpoint }) }),
  subscribeNotifications: (payload) => request("/api/notifications/subscriptions", { method: "POST", body: JSON.stringify(payload) }),
  updateNotificationPreferences: (payload) => request("/api/notifications/preferences", { method: "PUT", body: JSON.stringify(payload) }),
  unsubscribeNotifications: (endpoint) => request("/api/notifications/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  testNotification: (endpoint) => request("/api/notifications/test", { method: "POST", body: JSON.stringify({ endpoint }) }),
};

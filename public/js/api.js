async function request(path, options = {}) {
  const config = {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  };

  const response = await fetch(path, config);

  // Se a sessão do Cloudflare Access expirar com a PWA aberta, o fetch pode
  // terminar na página de autenticação. Nesse caso, leve o navegador até ela.
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

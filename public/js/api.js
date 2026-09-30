let reauthenticationStarted = false;

export class AuthenticationRequiredError extends Error {
  constructor(message = "Sessão do Cloudflare Access expirada.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export function isAuthenticationRequired(error) {
  return error?.name === "AuthenticationRequiredError";
}

function reauthenticate() {
  if (reauthenticationStarted) return;
  reauthenticationStarted = true;

  // /api/* nunca e servido pelo cache da PWA. Uma navegacao completa para esta
  // rota passa obrigatoriamente pelo Cloudflare Access. Se a sessao expirou, o
  // Access mostra o login; depois o endpoint redireciona de volta para o app.
  window.location.replace("/api/auth");
}

function authenticationRequired(message) {
  reauthenticate();
  return new AuthenticationRequiredError(message);
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

  let response;
  try {
    response = await fetch(path, config);
  } catch (error) {
    // Quando o Access redireciona uma requisicao AJAX para a tela de login,
    // alguns navegadores expõem isso apenas como TypeError/Failed to fetch.
    // Se o dispositivo esta online, force uma navegacao real para o Access.
    if (error instanceof TypeError && navigator.onLine) {
      throw authenticationRequired("Sessão expirada. Reconectando ao Cloudflare Access...");
    }
    throw error;
  }

  if (response.status === 401 || response.status === 403 || response.type === "opaqueredirect") {
    throw authenticationRequired("Sessão expirada. Reconectando ao Cloudflare Access...");
  }

  if (response.redirected && response.url && !response.url.startsWith(window.location.origin)) {
    throw authenticationRequired("Sessão expirada. Reconectando ao Cloudflare Access...");
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    // Uma pagina HTML inesperada em uma chamada da API normalmente e a pagina
    // intermediaria do Access. Nao apresente isso como "sem conexao".
    if (navigator.onLine) {
      throw authenticationRequired("Sessão expirada. Reconectando ao Cloudflare Access...");
    }
    if (!response.ok) throw new Error(`Erro ${response.status}`);
    throw new Error("A API retornou uma resposta inesperada.");
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

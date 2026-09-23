from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from workers import WorkerEntrypoint, asgi

from models import (
    CompletionPayload,
    NotificationPreferencesPayload,
    PushEndpointPayload,
    PushSubscriptionPayload,
    TagPayload,
    TaskPayload,
)
import notification_service
import repository
import webpush


APP_VERSION = "3.1.0-alpha.1"

app = FastAPI(
    title="Pine's Journal API",
    version=APP_VERSION,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


def database(request: Request):
    return request.scope["env"].DB


@app.middleware("http")
async def api_security_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/api/health")
async def health(request: Request):
    await repository.database_health(database(request))
    return {"ok": True, "app": "Pine's Journal", "version": APP_VERSION, "database": "ok"}


@app.get("/api/status")
async def app_status(request: Request):
    return {
        "ok": True,
        "app": "Pine's Journal",
        "version": APP_VERSION,
        "database": await repository.database_stats(database(request)),
    }


@app.get("/api/tasks")
async def get_tasks(request: Request):
    return {"items": await repository.list_tasks(database(request))}


@app.post("/api/tasks", status_code=status.HTTP_201_CREATED)
async def post_task(payload: TaskPayload, request: Request):
    return await repository.create_task(database(request), payload)


@app.put("/api/tasks/{task_id}")
async def put_task(task_id: str, payload: TaskPayload, request: Request):
    task = await repository.update_task(database(request), task_id, payload)
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return task


@app.patch("/api/tasks/{task_id}/completed")
async def patch_task_completed(task_id: str, payload: CompletionPayload, request: Request):
    task = await repository.set_completed(database(request), task_id, payload.completed)
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return task


@app.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_task(task_id: str, request: Request):
    if not await repository.delete_task(database(request), task_id):
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/tags")
async def get_tags(request: Request):
    return {"items": await repository.list_tags(database(request))}


@app.post("/api/tags", status_code=status.HTTP_201_CREATED)
async def post_tag(payload: TagPayload, request: Request):
    try:
        return await repository.create_tag(database(request), payload)
    except Exception as exc:
        message = str(exc).lower()
        if "unique" in message or "constraint" in message:
            raise HTTPException(status_code=409, detail="Já existe uma tag com esse nome.") from exc
        raise


@app.delete("/api/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_tag(tag_id: str, request: Request):
    if not await repository.delete_tag(database(request), tag_id):
        raise HTTPException(status_code=404, detail="Tag não encontrada.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/notifications/config")
async def notification_config(request: Request):
    env = request.scope["env"]
    available = webpush.configured(env)
    return {
        "available": available,
        "public_key": getattr(env, "VAPID_PUBLIC_KEY", None) if available else None,
        "default_time": "09:00",
    }


@app.post("/api/notifications/subscriptions")
async def subscribe_notifications(payload: PushSubscriptionPayload, request: Request):
    user_agent = request.headers.get("user-agent", "")
    return await repository.upsert_push_subscription(database(request), payload, user_agent)


@app.post("/api/notifications/status")
async def notification_status(payload: PushEndpointPayload, request: Request):
    item = await repository.get_push_subscription(database(request), payload.endpoint)
    return {"enabled": bool(item and item.get("enabled")), "subscription": item}


@app.put("/api/notifications/preferences")
async def notification_preferences(payload: NotificationPreferencesPayload, request: Request):
    item = await repository.update_push_preferences(database(request), payload)
    if not item:
        raise HTTPException(status_code=404, detail="Notificações não estão ativas neste dispositivo.")
    return item


@app.post("/api/notifications/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe_notifications(payload: PushEndpointPayload, request: Request):
    await repository.delete_push_subscription(database(request), payload.endpoint)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/notifications/test")
async def test_notifications(payload: PushEndpointPayload, request: Request):
    env = request.scope["env"]
    if not webpush.configured(env):
        raise HTTPException(status_code=503, detail="As chaves de notificações ainda não foram configuradas.")
    try:
        result = await notification_service.send_test(env, database(request), payload.endpoint)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not result["ok"]:
        if result["status"] in (404, 410):
            raise HTTPException(status_code=410, detail="A inscrição expirou. Ative as notificações novamente.")
        raise HTTPException(status_code=502, detail=f"O serviço de push respondeu HTTP {result['status']}.")
    return {"ok": True}


@app.exception_handler(Exception)
async def unexpected_error(_request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Erro interno do Pine's Journal.", "type": type(exc).__name__},
        headers={"Cache-Control": "no-store"},
    )


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await asgi.fetch(app, request, self.env)

    async def scheduled(self, controller, env, ctx):
        result = await notification_service.run_scheduled(env, controller.scheduledTime)
        print(f"Cron de notificacoes: {result}")

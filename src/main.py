from workers import WorkerEntrypoint, asgi
from http_app import app


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await asgi.fetch(app, request, self.env)

    async def scheduled(self, controller, env, ctx):
        import notification_service

        runtime_env = env if env is not None else getattr(self, "env", None)

        if runtime_env is None:
            raise RuntimeError("Bindings do Cloudflare Worker indisponiveis no Cron Trigger.")

        result = await notification_service.run_scheduled(
            runtime_env,
            controller.scheduledTime
        )

        print(f"Cron de notificacoes: {result}")

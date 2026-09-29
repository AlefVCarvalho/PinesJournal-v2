"""Entrypoint leve do Cloudflare Worker.

O caminho HTTP importa FastAPI sob demanda. Isso evita carregar FastAPI/Pydantic em
cada invocacao do Cron Trigger, o que e especialmente importante no Workers Free,
onde o limite de CPU por Cron Trigger e pequeno.
"""

from workers import WorkerEntrypoint


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        # Importe a camada HTTP somente quando houver uma requisicao web.
        from workers import asgi
        from http_app import app

        return await asgi.fetch(app, request, self.env)

    async def scheduled(self, controller, env, ctx):
        # Nao carregue FastAPI/Pydantic no caminho do Cron.
        import notification_service

        try:
            result = await notification_service.run_scheduled(env, controller.scheduledTime)
        except Exception as exc:
            message = str(exc)
            print(f"Cron de notificacoes falhou: {type(exc).__name__}: {message}")
            if "push_subscriptions" in message or "no such table" in message.lower():
                print(
                    "Verifique se as migrations do D1 foram aplicadas no banco remoto "
                    "(especialmente migrations/0002_notifications.sql)."
                )
            raise

        print(f"Cron de notificacoes: {result}")

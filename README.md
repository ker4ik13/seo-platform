# Realtime

Доставка presence, курсоров, выделений, комментариев и совместных документов.

Foundation-инкремент включает Socket.IO с Redis adapter, NATS, отдельную Prisma
схему и health endpoints. Вход в tenant/project rooms намеренно закрыт до
реализации проверки access token, membership и permission snapshot.

Entrypoint: `src/main.ts`, порт по умолчанию `4003`.

FROM postgres:18.3-alpine3.23 AS postgres-runtime

COPY --chmod=0444 infrastructure/postgres/init/ /docker-entrypoint-initdb.d/
COPY --chmod=0555 infrastructure/postgres/config/start-postgres.sh /postgres-config/start-postgres.sh


FROM postgres:18.3-alpine3.23 AS postgres-tooling

COPY --chmod=0444 infrastructure/postgres/roles/ /database-roles/
COPY --chmod=0444 infrastructure/postgres/permissions/ /permissions/
RUN chmod 0555 \
  /database-roles/provision-service-database-roles.sh \
  /permissions/provision-jobs-connector-role.sh \
  /permissions/provision-realtime-web-push-role.sh \
  /permissions/provision-service-runtime-role.sh


FROM postgres:18.3-alpine3.23 AS service-token-preflight

COPY --chmod=0555 infrastructure/security/validate-service-tokens.sh /security/validate-service-tokens.sh


FROM redis:8.8.1-alpine3.23 AS redis-runtime

COPY --chmod=0444 infrastructure/redis/jobs.conf infrastructure/redis/realtime.conf /redis/
COPY --chmod=0555 infrastructure/redis/render-acl.sh infrastructure/redis/start-redis.sh /redis/


FROM nats:2.12.12-alpine AS nats-runtime

COPY --chmod=0444 infrastructure/nats/nats-server.conf /etc/nats/nats-server.conf
COPY --chmod=0555 infrastructure/nats/start-nats.sh /etc/nats/start-nats.sh


FROM clamav/clamav:1.5.3-debian13-slim AS clamav-runtime

COPY --chmod=0444 infrastructure/clamav/clamd.conf /etc/clamav/clamd.conf

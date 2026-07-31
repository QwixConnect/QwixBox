#!/usr/bin/env bash
### Redis, used by FreeSWITCH via mod_hiredis and by the API for caching.
###
# step-inputs: resources/conf/redis
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/redis"

apt_install redis-server

config_ensure_secret REDIS_PASSWORD 40

### Same reasoning as Postgres: loopback only unless roles are split.
if is_all_in_one; then
  redis_bind="127.0.0.1 -::1"
else
  redis_bind="127.0.0.1 $(internal_bind_addr) -::1"
fi

deploy_template "$TPL/90-qwixbox.conf" /etc/redis/redis.conf.d/90-qwixbox.conf 0640 redis:redis || true

### Debian's redis.conf does not include a conf.d directory by default.
if ! grep -q "^include /etc/redis/redis.conf.d/" /etc/redis/redis.conf; then
  install -d -m 0750 -o redis -g redis /etc/redis/redis.conf.d
  printf '\n# Added by the Qwixbox installer.\ninclude /etc/redis/redis.conf.d/*.conf\n' \
    >> /etc/redis/redis.conf
  info "Enabled /etc/redis/redis.conf.d includes"
fi

enable_service redis-server
restart_service redis-server

if redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
  ok "Redis responding on ${redis_bind} port ${REDIS_PORT:-6379} (password protected)"
else
  die "Redis is not responding to an authenticated PING."
fi

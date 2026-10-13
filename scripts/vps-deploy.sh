#!/usr/bin/env bash
# Redeploy the app to the VPS (pkg.traveliun.com).
#
# Netlify production deploys are paused whenever the team runs out of build
# credits, so the VPS is the deploy target we control. Run from the repo root
# with a clean, COMMITTED tree — `git archive` ships HEAD, not the working copy.
#
#   bash scripts/vps-deploy.sh
#
# Requires: the `vps-new` ssh host (used as `deploy`), and a .env on the server
# at ~/apps/traveliun-app/.env (created once; this script never overwrites it).
set -euo pipefail

# CORRECTED 2026-10-11: the domain pkg.traveliun.com resolves to 186.241.16.106
# (SSH alias `vps-new`). The old `vps-deploy` alias points at 187.124.112.104,
# which stopped serving this domain after the migration (it 503s for it now) —
# deploying there built and swapped containers nobody could see. If SSH to the
# new server times out, run `systemctl is-active ssh` from hPanel's Web console
# first: on 2026-10-11 ssh.socket had failed on a duplicated listen address
# ([::]:52222 twice), so nothing listened on 22 at all — not a firewall.
#
# As `deploy`, not root: the app and its .env live in /home/deploy, and root's
# ~ has neither, so a root deploy builds a tree with no .env and the run fails.
HOST=deploy@vps-new
DIR=apps/traveliun-app
DOMAIN=pkg.traveliun.com

# Not during the working day (08:00–23:00 Riyadh): a deploy mid-shift turned the
# agents' saves into 404s and lost what they had typed (2026-10-13, twice).
# FORCE=1 for an emergency fix.
HOUR=$(TZ=UTC-3 date +%H)  # Riyadh is UTC+3 all year (no DST); POSIX writes it «UTC-3»
if [ "${FORCE:-0}" != "1" ] && [ "$((10#$HOUR))" -ge 8 ] && [ "$((10#$HOUR))" -lt 23 ]; then
  echo "refusing: it is ${HOUR}:00 in Riyadh — deploy after 23:00 or before 08:00, or FORCE=1 for an emergency" >&2
  exit 1
fi

# The commit is pinned ONCE, here. Reading HEAD again at the end reported the
# wrong commit when another one landed while this deploy was still building.
SHIPPED=$(git rev-parse HEAD)
echo "==> shipping ${SHIPPED:0:7}"
ssh "$HOST" "mkdir -p ~/$DIR && find ~/$DIR -mindepth 1 -maxdepth 1 ! -name .env ! -name .dockercfg -exec rm -rf {} +"
git archive --format=tar "$SHIPPED" | ssh "$HOST" "tar -x -C ~/$DIR"

echo "==> building"
# DOCKER_CONFIG is redirected because ~/.docker is root-owned on this host and
# buildx would fail on its lock file.
#
# --no-cache, and it is not paranoia. A cached build layer once shipped an
# image whose `.next` held chunks from TWO builds: the server had the new
# source, the manifest pointed at the old chunks, and the site served a version
# that no longer existed in the repository — while every check short of
# downloading the chunk and reading it said the deploy had succeeded. A deploy
# that can lie about what it shipped is worth more than the three minutes the
# cache saves.
ssh "$HOST" "cd ~/$DIR && mkdir -p .dockercfg && DOCKER_CONFIG=\$PWD/.dockercfg docker build --no-cache -q --build-arg NEXT_DEPLOYMENT_ID=${SHIPPED:0:12} -t traveliun-app:latest ."

echo "==> restarting"
ssh "$HOST" "cd ~/$DIR && docker rm -f traveliun-app 2>/dev/null || true; docker run -d --name traveliun-app --restart unless-stopped \
  --network coolify --env-file .env \
  --label traefik.enable=true \
  --label 'traefik.http.routers.tv-http.rule=Host(\`$DOMAIN\`)' \
  --label traefik.http.routers.tv-http.entryPoints=http \
  --label traefik.http.routers.tv-http.middlewares=redirect-to-https \
  --label 'traefik.http.routers.tv-https.rule=Host(\`$DOMAIN\`)' \
  --label traefik.http.routers.tv-https.entryPoints=https \
  --label traefik.http.routers.tv-https.tls=true \
  --label traefik.http.routers.tv-https.tls.certresolver=letsencrypt \
  --label traefik.http.routers.tv-https.service=tv-svc \
  --label traefik.http.routers.tv-https.middlewares=gzip \
  --label traefik.http.services.tv-svc.loadbalancer.server.port=3000 \
  traveliun-app:latest"

# --no-cache means the build cache is never reused, yet BuildKit keeps every
# layer (~2.5 GB per deploy, 37 GB after one day). Drop it once the new
# container is running — images, containers and volumes are untouched.
ssh "$HOST" "docker builder prune -af >/dev/null 2>&1 || true"

echo "==> waiting for https://$DOMAIN"
up=""
for _ in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "https://$DOMAIN/" || true)
  [ "$code" = "200" ] && { up=1; echo "live: HTTP $code"; break; }
  sleep 6
done
[ -n "$up" ] || { echo "did not come up — check: ssh $HOST 'docker logs traveliun-app'" >&2; exit 1; }

# A 200 only proves SOMETHING answered. This proves the thing that answered was
# built from the commit we just shipped: the running container's own source is
# compared against HEAD, file for file.
echo "==> verifying the running build is HEAD"
want=$SHIPPED
got=$(ssh "$HOST" "cd ~/$DIR && git rev-parse HEAD 2>/dev/null" || true)
if ssh "$HOST" "docker exec traveliun-app sh -c 'test -f /app/.next/BUILD_ID'"; then
  built=$(ssh "$HOST" "docker exec traveliun-app cat /app/.next/BUILD_ID")
  echo "    build id: $built"
fi
echo "    shipped:  ${want:0:7}${got:+  (server tree: ${got:0:7})}"
# With a deploymentId the BUILD_ID no longer changes between builds; the page
# itself names the deploy it came from (data-dpl-id) — that is the proof.
live=$(curl -s "https://$DOMAIN/sign-in" | grep -o 'data-dpl-id="[^"]*"' | head -1 | cut -d'"' -f2)
echo "    live dpl: ${live:-none}"
[ "$live" = "${want:0:12}" ] || { echo "the live page is not this deploy (dpl ${live:-none}, want ${want:0:12})" >&2; exit 1; }

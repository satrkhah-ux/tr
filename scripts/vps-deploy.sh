#!/usr/bin/env bash
# Redeploy the app to the VPS (pkg.traveliun.com).
#
# Netlify production deploys are paused whenever the team runs out of build
# credits, so the VPS is the deploy target we control. Run from the repo root
# with a clean, COMMITTED tree — `git archive` ships HEAD, not the working copy.
#
#   bash scripts/vps-deploy.sh
#
# Requires: the `vps-deploy` ssh host, and a .env on the server at
# ~/apps/traveliun-app/.env (created once; this script never overwrites it).
set -euo pipefail

HOST=vps-deploy
DIR=apps/traveliun-app
DOMAIN=pkg.traveliun.com

echo "==> shipping HEAD ($(git rev-parse --short HEAD))"
ssh "$HOST" "mkdir -p ~/$DIR && find ~/$DIR -mindepth 1 -maxdepth 1 ! -name .env ! -name .dockercfg -exec rm -rf {} +"
git archive --format=tar HEAD | ssh "$HOST" "tar -x -C ~/$DIR"

echo "==> building"
# DOCKER_CONFIG is redirected because ~/.docker is root-owned on this host and
# buildx would fail on its lock file.
ssh "$HOST" "cd ~/$DIR && mkdir -p .dockercfg && DOCKER_CONFIG=\$PWD/.dockercfg docker build -q -t traveliun-app:latest ."

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

echo "==> waiting for https://$DOMAIN"
for _ in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "https://$DOMAIN/" || true)
  [ "$code" = "200" ] && { echo "live: HTTP $code"; exit 0; }
  sleep 6
done
echo "did not come up — check: ssh $HOST 'docker logs traveliun-app'" >&2
exit 1

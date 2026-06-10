#!/usr/bin/env bash
# adversarial 演练：启动 / 停止 靶场 + 内部服务。
# 日志/PID 都落到 /tmp，方便从外部观察和清理。

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_APP="${REPO_ROOT}/adversarial/target-app"
SERVICES_DIR="${REPO_ROOT}/adversarial/internal-services"

TARGET_LOG=/tmp/finesoft-target.log
TARGET_PID=/tmp/finesoft-target.pid
META_LOG=/tmp/finesoft-metadata.log
META_PID=/tmp/finesoft-metadata.pid
ADMIN_LOG=/tmp/finesoft-admin-welcome.log
ADMIN_PID=/tmp/finesoft-admin-welcome.pid

cmd="${1:-start}"

stop_one() {
    local pidfile="$1" name="$2"
    if [[ -f "${pidfile}" ]]; then
        local pid
        pid="$(cat "${pidfile}")"
        if kill -0 "${pid}" 2>/dev/null; then
            kill "${pid}" || true
            echo "[stop] ${name} pid=${pid}"
        fi
        rm -f "${pidfile}"
    fi
}

start_all() {
    echo "[start] metadata-server (127.0.0.1:9999)"
    nohup node "${SERVICES_DIR}/metadata-server.mjs" > "${META_LOG}" 2>&1 &
    echo $! > "${META_PID}"

    echo "[start] admin-welcome (127.0.0.1:5174)"
    nohup node "${SERVICES_DIR}/admin-welcome.mjs" > "${ADMIN_LOG}" 2>&1 &
    echo $! > "${ADMIN_PID}"

    echo "[start] target-app (vp dev on :5173)"
    (cd "${TARGET_APP}" && nohup vp dev > "${TARGET_LOG}" 2>&1 &
     echo $! > "${TARGET_PID}")

    sleep 4
    echo
    echo "Tail logs:  tail -f ${TARGET_LOG}"
    echo "Stop:       ${BASH_SOURCE[0]} stop"
    echo
    if curl -fsS http://localhost:5173/ -o /dev/null; then
        echo "[ok] target-app responding on http://localhost:5173/"
    else
        echo "[!] target-app not responding yet; tail ${TARGET_LOG}"
        tail -20 "${TARGET_LOG}"
    fi
}

case "${cmd}" in
    start)
        start_all
        ;;
    stop)
        stop_one "${TARGET_PID}" target-app
        stop_one "${META_PID}" metadata-server
        stop_one "${ADMIN_PID}" admin-welcome
        ;;
    restart)
        stop_one "${TARGET_PID}" target-app
        stop_one "${META_PID}" metadata-server
        stop_one "${ADMIN_PID}" admin-welcome
        sleep 1
        start_all
        ;;
    *)
        echo "usage: $0 {start|stop|restart}" >&2
        exit 2
        ;;
esac

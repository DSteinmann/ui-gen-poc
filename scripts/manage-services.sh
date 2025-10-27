#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="${ROOT_DIR}/scripts/.pids"
LOG_DIR="${ROOT_DIR}/scripts/logs"
mkdir -p "${PID_DIR}" "${LOG_DIR}"

SERVICES=(
  "core-system:packages/core-system:npm start"
  "knowledge-base:packages/knowledge-base:npm start"
  "capability-system:packages/capability-system:npm start"
  "device-api:packages/device:npm start"
  "device-ui:packages/device:npm run dev"
)

usage() {
  cat <<'EOF'
Usage: manage-services.sh [start|stop|restart|status]

Commands:
  start    Launch all services in the background.
  stop     Stop all running services managed by this script.
  restart  Stop, then start all services again.
  status   Print whether each managed service is running.
EOF
}

service_pid_file() {
  local name="$1"
  echo "${PID_DIR}/${name}.pid"
}

service_log_file() {
  local name="$1"
  echo "${LOG_DIR}/${name}.log"
}

start_service() {
  local name="$1"; shift
  local path="$1"; shift
  local command="$*"
  local pid_file="$(service_pid_file "${name}")"
  local log_file="$(service_log_file "${name}")"

  if [[ -f "${pid_file}" ]]; then
    local pid
    pid=$(cat "${pid_file}" 2>/dev/null || true)
    if [[ -n "${pid}" ]]; then
      if kill -0 "${pid}" 2>/dev/null; then
        echo "[skip] ${name} already running with PID ${pid}"
        return
      else
        rm -f "${pid_file}"
      fi
    fi
  fi

  echo "[start] ${name} -> ${command}"
  (
    cd "${ROOT_DIR}/${path}"
    nohup bash -lc "${command}" >>"${log_file}" 2>&1 &
    echo $! >"${pid_file}"
  )
}

stop_service() {
  local name="$1"
  local pid_file="$(service_pid_file "${name}")"
  if [[ ! -f "${pid_file}" ]]; then
    echo "[stop] ${name} not running (no pid file)"
    return
  fi

  local pid
  pid=$(cat "${pid_file}" 2>/dev/null || true)
  if [[ -z "${pid}" ]]; then
    echo "[stop] ${name} pid file empty"
    rm -f "${pid_file}"
    return
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    echo "[stop] ${name} (PID ${pid})"
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
  else
    echo "[stop] ${name} already stopped"
  fi
  rm -f "${pid_file}"
}

status_service() {
  local name="$1"
  local pid_file="$(service_pid_file "${name}")"
  if [[ ! -f "${pid_file}" ]]; then
    echo "[status] ${name}: stopped"
    return
  fi
  local pid
  pid=$(cat "${pid_file}" 2>/dev/null || true)
  if [[ -n "${pid}" ]]; then
    if kill -0 "${pid}" 2>/dev/null; then
      echo "[status] ${name}: running (PID ${pid})"
      return
    fi
  fi
  echo "[status] ${name}: stopped (stale pid file)"
  rm -f "${pid_file}"
}

start_all() {
  for service in "${SERVICES[@]}"; do
    IFS=":" read -r name path command <<<"${service}"
    start_service "${name}" "${path}" ${command}
  done
  echo "Logs live in ${LOG_DIR}."
}

stop_all() {
  for service in "${SERVICES[@]}"; do
    IFS=":" read -r name _ <<<"${service}"
    stop_service "${name}"
  done
}

status_all() {
  for service in "${SERVICES[@]}"; do
    IFS=":" read -r name _ <<<"${service}"
    status_service "${name}"
  done
}

command="${1:-start}"
case "${command}" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    ;;
  status)
    status_all
    ;;
  *)
    usage
    exit 1
    ;;
esac

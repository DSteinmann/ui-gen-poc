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
  "device-api:packages/device:node server.js"
  "device-ui:packages/device:npm run dev"
)

service_ports() {
  case "$1" in
    core-system) echo "3000,3001" ;;
    knowledge-base) echo "3005" ;;
    capability-system) echo "3003" ;;
    device-api) echo "3002" ;;
    device-ui) echo "5173" ;;
    *) echo "" ;;
  esac
}

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

  : >"${log_file}"

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
    nohup bash -lc "exec ${command}" >>"${log_file}" 2>&1 &
    local child_pid=$!
    echo "${child_pid}" >"${pid_file}"
  )
}

terminate_pid_tree() {
  local pid="$1"
  local label="$2"

  if [[ -z "${pid}" ]]; then
    return
  fi

  if ! kill -0 "${pid}" 2>/dev/null; then
    return
  fi

  local children
  children=$(pgrep -P "${pid}" 2>/dev/null || true)
  if [[ -n "${children}" ]]; then
    for child in ${children}; do
      terminate_pid_tree "${child}" "${label} (child)"
    done
  fi

  kill "${pid}" 2>/dev/null || true

  for _ in {1..10}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done

  if kill -0 "${pid}" 2>/dev/null; then
    echo "[stop] ${label} pid ${pid} resisting termination; sending SIGKILL"
    kill -9 "${pid}" 2>/dev/null || true
    sleep 0.2
  fi
}

kill_listeners_for_ports() {
  local name="$1"
  local ports="$2"

  if [[ -z "${ports}" ]]; then
    return
  fi

  IFS=',' read -ra port_array <<<"${ports}"
  for port in "${port_array[@]}"; do
    port="${port//[[:space:]]/}"
    [[ -z "${port}" ]] && continue

    local pids
    pids=$(lsof -nP -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | sort -u || true)

    for listener_pid in ${pids}; do
      echo "[stop] ${name} found listener ${listener_pid} on port ${port}; terminating"
      kill "${listener_pid}" 2>/dev/null || true
      sleep 0.3
      if kill -0 "${listener_pid}" 2>/dev/null; then
        kill -9 "${listener_pid}" 2>/dev/null || true
      fi
    done
  done
}

stop_service() {
  local name="$1"
  local pid_file="$(service_pid_file "${name}")"
  local ports="$(service_ports "${name}")"
  if [[ ! -f "${pid_file}" ]]; then
    echo "[stop] ${name} not running (no pid file)"
    kill_listeners_for_ports "${name}" "${ports}"
    return
  fi

  local pid
  pid=$(cat "${pid_file}" 2>/dev/null || true)
  if [[ -z "${pid}" ]]; then
    echo "[stop] ${name} pid file empty"
    rm -f "${pid_file}"
    kill_listeners_for_ports "${name}" "${ports}"
    return
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    echo "[stop] ${name} (PID ${pid})"
    terminate_pid_tree "${pid}" "${name}"
  else
    echo "[stop] ${name} already stopped"
  fi
  rm -f "${pid_file}"
  kill_listeners_for_ports "${name}" "${ports}"
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
  rm -f "${LOG_DIR}"/*.log 2>/dev/null || true
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

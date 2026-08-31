#!/bin/sh
set -eu

export DISPLAY="${DISPLAY:-:99}"

display_number="${DISPLAY#:}"
x_lock="/tmp/.X${display_number}-lock"
x_socket="/tmp/.X11-unix/X${display_number}"
if [ -f "${x_lock}" ]; then
  lock_pid="$(tr -d '[:space:]' < "${x_lock}" 2>/dev/null || true)"
  if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
    echo "X display ${DISPLAY} is already owned by PID ${lock_pid}" >&2
    exit 1
  fi
  rm -f "${x_lock}"
fi
if [ -S "${x_socket}" ]; then
  rm -f "${x_socket}"
fi

Xvfb "${DISPLAY}" -screen 0 1440x1000x24 -nolisten tcp &

attempt=0
until xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 40 ]; then
    echo "Xvfb did not become ready on ${DISPLAY}" >&2
    exit 1
  fi
  sleep 0.25
done

x11vnc -display "${DISPLAY}" -localhost -forever -shared -nopw -rfbport 5900 &
websockify --web=/usr/share/novnc 0.0.0.0:6080 localhost:5900 &

exec node dist/start.js

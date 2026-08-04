import { io } from 'socket.io-client';

export const socket = io();

const PLAYER_KEY = 'rummi-player-id';
const SESSION_KEY = 'rummi-session';

// Стабильный идентификатор игрока, переживающий обновление страницы.
export function getPlayerId() {
  let id = localStorage.getItem(PLAYER_KEY);
  if (!id) {
    id = 'u' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
    localStorage.setItem(PLAYER_KEY, id);
  }
  return id;
}

// Сессия: в какой комнате находился игрок, чтобы восстановиться после refresh.
export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveSession(code, name) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, name }));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function emit(event, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) {
      socket.emit(event, (res) => resolve(res || { ok: true }));
    } else {
      socket.emit(event, payload, (res) => resolve(res || { ok: true }));
    }
  });
}
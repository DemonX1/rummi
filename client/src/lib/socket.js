import { io } from 'socket.io-client';

// Адрес бэкенда. По умолчанию — тот же origin (dev-прокси / production-сервер).
// Для GitHub Pages (клиент отдельно от сервера) задайте при сборке:
//   VITE_SERVER_URL=https://your-backend.example.com npm run build
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

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

// Профиль игрока: цвет и смайлик-аватарка (звери). Переживает обновление страницы.
const PROFILE_KEY = 'rummi-profile';
export const PLAYER_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
export const PLAYER_EMOJIS = ['🐶', '🐱', '🦊', '🐻', '🐼', '🦁', '🐸', '🐵', '🦉', '🐺'];
const DEFAULT_PROFILE = { color: PLAYER_COLORS[3], emoji: PLAYER_EMOJIS[0] };

export function getProfile() {
  try {
    return { ...DEFAULT_PROFILE, ...(JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null')) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
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
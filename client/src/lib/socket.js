import { io } from 'socket.io-client';

// Адрес бэкенда. По умолчанию — тот же origin (dev-прокси / production-сервер).
// Для GitHub Pages (клиент отдельно от сервера) задайте при сборке:
//   VITE_SERVER_URL=https://your-backend.example.com npm run build
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

const PLAYER_KEY = 'rummi-player-id';
const SESSION_KEY = 'rummi-session';

// Стабильный идентификатор устройства, переживающий обновление страницы.
export function getPlayerId() {
  let id = localStorage.getItem(PLAYER_KEY);
  if (!id) {
    id = 'u' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
    localStorage.setItem(PLAYER_KEY, id);
  }
  return id;
}

// Привязка устройства к серверному профилю: устройство может быть «слито» с
// профилем другого устройства через код привязки. Источник истины — сервер;
// здесь лишь кэш, чтобы подсветки работали до первого ответа сервера.
const PID_KEY = 'rummi-profile-id';

export function getCachedProfileId() {
  return localStorage.getItem(PID_KEY);
}

export function cacheProfileId(pid) {
  if (pid) localStorage.setItem(PID_KEY, pid);
  else localStorage.removeItem(PID_KEY);
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
// Источник правды для постоянных данных — серверное хранилище профилей; localStorage —
// лишь кэш выбранного в этой сессии. «touched» = игрок менял аватарку сейчас.
const PROFILE_KEY = 'rummi-profile';
export const PLAYER_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
export const PLAYER_EMOJIS = ['🐶', '🐱', '🦊', '🐻', '🐼', '🦁', '🐸', '🐵', '🦉', '🐺'];
const DEFAULT_PROFILE = { color: PLAYER_COLORS[3], emoji: PLAYER_EMOJIS[0] };
let profileTouched = false;

export function getProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    return { ...DEFAULT_PROFILE, ...saved, touched: profileTouched };
  } catch {
    return { ...DEFAULT_PROFILE, touched: profileTouched };
  }
}

export function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ color: profile.color, emoji: profile.emoji }));
}

// Игрок вручную изменил аватарку в этой сессии — сервер должен обновить запись.
export function markProfileTouched() {
  profileTouched = true;
}

// Сервер вернул сохранённый профиль (тот же логин): подхватываем его,
// если игрок сам ничего не менял. Так данные приходят с сервера, а не с устройства.
export function syncProfileFromServer(color, emoji) {
  if (profileTouched) return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ color, emoji }));
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
import React, { useState } from 'react';

export default function Home({ actions }) {
  const [name, setName] = useState(localStorage.getItem('rummi-name') || '');
  const [code, setCode] = useState('');

  const saveName = (n) => {
    setName(n);
    localStorage.setItem('rummi-name', n);
  };

  const submit = (fn) => {
    if (!name.trim()) return;
    saveName(name.trim());
    fn();
  };

  return (
    <div className="home">
      <div className="hero">
        <h1 className="logo">
          <span className="logo-tile t-r">1</span>
          <span className="logo-tile t-b">7</span>
          <span className="logo-tile t-k">13</span>
          <span className="logo-tile t-y">3</span>
          <span className="logo-text">Румикуб</span>
        </h1>
        <p className="tagline">Собери число, обыграй друзей или сразись с компьютером.</p>
      </div>

      <div className="panel auth-panel">
        <label className="field">
          <span>Ваше имя</span>
          <input
            value={name}
            maxLength={20}
            placeholder="Введите имя"
            onChange={(e) => saveName(e.target.value)}
          />
        </label>

        <button
          className="btn btn-primary btn-lg"
          disabled={!name.trim()}
          onClick={() => submit(() => actions.create(name.trim(), false))}
        >
          Создать комнату
        </button>
        <button
          className="btn btn-ghost btn-lg"
          disabled={!name.trim()}
          onClick={() => submit(() => actions.create(name.trim(), true))}
        >
          Играть с компьютером
        </button>

        <div className="divider"><span>или</span></div>

        <div className="join-row">
          <input
            value={code}
            maxLength={5}
            placeholder="Код комнаты"
            className="code-input"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            className="btn btn-accent"
            disabled={!name.trim() || code.trim().length < 4}
            onClick={() => submit(() => actions.join(code.trim(), name.trim()))}
          >
            Присоединиться
          </button>
        </div>
      </div>

      <div className="rules-hint">
        Составьте группы на 30+ очков, выложите первые фишки и сосредоточьтесь на самом
        интересном — Румикубе!
      </div>
    </div>
  );
}
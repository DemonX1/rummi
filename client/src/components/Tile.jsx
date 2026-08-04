import React from 'react';
import { isJoker } from '../lib/melds.js';

export default function Tile({ tile, selected, onClick, dimmed, size }) {
  const joker = isJoker(tile);
  const color = joker ? 'joker' : tile.color.toLowerCase();
  return (
    <div
      className={`tile tile-${size || 'md'} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
      onClick={onClick}
    >
      {joker ? (
        <span className="tile-joker">J</span>
      ) : (
        <span className={`tile-num tile-num-${color}`}>{tile.value}</span>
      )}
    </div>
  );
}
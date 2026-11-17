import type { Map as MlMap } from 'maplibre-gl';

export const CLASS_COLORS = {
  emergency: '#FF4D4F',
  heli: '#FFB020',
  military: '#4C8DFF',
  low: '#E6EDF3',
  normal: '#8FA3B8',
  selected: '#3DD6F5',
} as const;

const SIZE = 64; // drawn at 2x, displayed at 32px

function draw(shape: 'plane' | 'heli', color: string): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  g.translate(SIZE / 2, SIZE / 2);
  g.fillStyle = color;
  g.strokeStyle = 'rgba(11,15,20,0.95)';
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.beginPath();
  if (shape === 'plane') {
    // Chevron pointing north; rotated on the map by track.
    g.moveTo(0, -22);
    g.lineTo(15, 18);
    g.lineTo(0, 9);
    g.lineTo(-15, 18);
    g.closePath();
  } else {
    // Helicopter: body dot with a rotor ring and a tail.
    g.arc(0, 0, 9, 0, Math.PI * 2);
  }
  g.stroke();
  g.fill();
  if (shape === 'heli') {
    g.beginPath();
    g.lineWidth = 3;
    g.strokeStyle = color;
    g.arc(0, 0, 18, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(0, 9);
    g.lineTo(0, 26);
    g.stroke();
  }
  return g.getImageData(0, 0, SIZE, SIZE);
}

/** Register aircraft icons on the current style (call after each style load). */
export function addAircraftIcons(map: MlMap) {
  for (const [cls, color] of Object.entries(CLASS_COLORS)) {
    for (const shape of ['plane', 'heli'] as const) {
      const id = `ac-${shape}-${cls}`;
      if (!map.hasImage(id)) map.addImage(id, draw(shape, color), { pixelRatio: 2 });
    }
  }
}

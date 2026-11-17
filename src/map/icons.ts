import type { Map as MlMap } from 'maplibre-gl';

export const CLASS_COLORS = {
  emergency: '#FF4D4F',
  heli: '#FFB020',
  military: '#4C8DFF',
  low: '#E6EDF3',
  normal: '#8FA3B8',
  selected: '#3DD6F5',
} as const;

export const DRONE_COLOR = '#C084FC';
export const CAMERA_COLOR = '#7DD3FC';
export const TRANSIT_COLOR = '#34D399';
export const RADIO_COLOR = '#2DD4BF';
export const WEBCAM_COLOR = '#F0ABFC';
export const SEVERITY_COLORS = ['#8FA3B8', '#4C8DFF', '#FFB020', '#FF7A45', '#FF4D4F'];

const SIZE = 64; // drawn at 2x, displayed at 32px

function canvas(draw: (g: CanvasRenderingContext2D) => void): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  g.translate(SIZE / 2, SIZE / 2);
  g.lineJoin = 'round';
  draw(g);
  return g.getImageData(0, 0, SIZE, SIZE);
}

function aircraft(shape: 'plane' | 'heli', color: string): ImageData {
  return canvas((g) => {
    g.fillStyle = color;
    g.strokeStyle = 'rgba(11,15,20,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    if (shape === 'plane') {
      g.moveTo(0, -22);
      g.lineTo(15, 18);
      g.lineTo(0, 9);
      g.lineTo(-15, 18);
      g.closePath();
    } else g.arc(0, 0, 9, 0, Math.PI * 2);
    g.stroke();
    g.fill();
    if (shape === 'heli') {
      g.beginPath();
      g.strokeStyle = color;
      g.arc(0, 0, 18, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(0, 9);
      g.lineTo(0, 26);
      g.stroke();
    }
  });
}

const drone = () =>
  canvas((g) => {
    g.strokeStyle = DRONE_COLOR;
    g.fillStyle = 'rgba(11,15,20,0.9)';
    g.lineWidth = 4;
    // Quadcopter: X frame with four rotors.
    for (const [x, y] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(x, y);
      g.stroke();
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.fillStyle = DRONE_COLOR;
    g.arc(0, 0, 5, 0, Math.PI * 2);
    g.fill();
  });

const pilot = () =>
  canvas((g) => {
    g.fillStyle = 'rgba(11,15,20,0.9)';
    g.strokeStyle = DRONE_COLOR;
    g.lineWidth = 4;
    g.beginPath();
    g.rect(-11, -11, 22, 22);
    g.fill();
    g.stroke();
    g.fillStyle = DRONE_COLOR;
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('P', 0, 1);
  });

const camera = () =>
  canvas((g) => {
    g.fillStyle = 'rgba(11,15,20,0.9)';
    g.strokeStyle = CAMERA_COLOR;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(-14, -9, 20, 18, 3);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(6, -4);
    g.lineTo(15, -9);
    g.lineTo(15, 9);
    g.lineTo(6, 4);
    g.closePath();
    g.fill();
    g.stroke();
  });

function traffic(color: string) {
  return canvas((g) => {
    g.fillStyle = color;
    g.strokeStyle = 'rgba(11,15,20,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -17);
    g.lineTo(17, 13);
    g.lineTo(-17, 13);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#0B0F14';
    g.fillRect(-2, -6, 4, 10);
    g.fillRect(-2, 7, 4, 3);
  });
}

function flame(color: string) {
  return canvas((g) => {
    g.fillStyle = color;
    g.strokeStyle = 'rgba(11,15,20,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -22);
    g.bezierCurveTo(14, -8, 16, 4, 12, 12);
    g.bezierCurveTo(8, 20, -8, 20, -12, 12);
    g.bezierCurveTo(-16, 4, -10, -4, -6, -8);
    g.bezierCurveTo(-4, -2, -2, 0, 0, 2);
    g.bezierCurveTo(2, -6, -2, -14, 0, -22);
    g.closePath();
    g.stroke();
    g.fill();
    g.fillStyle = '#FFF3C4';
    g.beginPath();
    g.ellipse(0, 10, 5, 7, 0, 0, Math.PI * 2);
    g.fill();
  });
}

function webcam() {
  return canvas((g) => {
    g.fillStyle = 'rgba(11,15,20,0.9)';
    g.strokeStyle = WEBCAM_COLOR;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, -3, 12, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.fillStyle = WEBCAM_COLOR;
    g.arc(0, -3, 5, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-9, 12, 18, 4);
  });
}

function transit(color: string) {
  return canvas((g) => {
    g.fillStyle = 'rgba(11,15,20,0.92)';
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(-13, -15, 26, 26, 6);
    g.fill();
    g.stroke();
    g.fillStyle = color;
    g.fillRect(-8, -9, 16, 8); // windshield
    g.beginPath();
    g.arc(-6, 6, 2.6, 0, Math.PI * 2);
    g.arc(6, 6, 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-9, 12, 4, 5);
    g.fillRect(5, 12, 4, 5);
  });
}

function news(color: string) {
  return canvas((g) => {
    g.fillStyle = color;
    g.strokeStyle = 'rgba(11,15,20,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(-12, -12, 24, 24, 4);
    g.fill();
    g.stroke();
    g.fillStyle = '#0B0F14';
    for (const y of [-6, 0, 6]) g.fillRect(-7, y - 1.5, 14, 3);
  });
}

/** Register map icons on the current style (call after each style load). */
export function addIcons(map: MlMap) {
  const add = (id: string, img: () => ImageData) => !map.hasImage(id) && map.addImage(id, img(), { pixelRatio: 2 });
  for (const [cls, color] of Object.entries(CLASS_COLORS)) {
    add(`ac-plane-${cls}`, () => aircraft('plane', color));
    add(`ac-heli-${cls}`, () => aircraft('heli', color));
  }
  add('drone', drone);
  add('pilot', pilot);
  add('camera', camera);
  add('webcam', webcam);
  add('fire-rx', () => flame('#8FA3B8'));
  SEVERITY_COLORS.forEach((c, i) => {
    add(`traffic-${i}`, () => traffic(c));
    add(`news-${i}`, () => news(c));
    add(`transit-${i}`, () => transit(i < 1 ? TRANSIT_COLOR : c));
    add(`fire-${i}`, () => flame(i < 2 ? '#FFB020' : c));
  });
}

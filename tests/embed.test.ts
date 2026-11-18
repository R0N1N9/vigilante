// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { embedUrl, parseCity, parseEmbed, parseTheme } from '../src/lib/embed';
import { aiRequest, aiResult } from '../src/lib/ai';
import { ntfyJson } from '../src/lib/http';

describe('embed URL params', () => {
  it('turns on with embed.html or ?embed=1', () => {
    expect(parseEmbed('', '/vigilante/embed.html').embed).toBe(true);
    expect(parseEmbed('?embed=1', '/').embed).toBe(true);
    expect(parseEmbed('?embed=true', '/').embed).toBe(true);
    expect(parseEmbed('', '/vigilante/').embed).toBe(false);
    expect(parseEmbed('?embed=0', '/index.html').embed).toBe(false);
  });

  it('reads view only in embed mode (elsewhere ?view= is a pop-out)', () => {
    expect(parseEmbed('?embed=1&view=map').view).toBe('map');
    expect(parseEmbed('?embed=1&view=dashboard').view).toBe('dashboard');
    expect(parseEmbed('?embed=1&view=sky').view).toBeNull();
    expect(parseEmbed('?view=map').view).toBeNull();
  });

  it('parses cities and coordinates', () => {
    expect(parseCity('Denver')).toEqual({ kind: 'pack', id: 'denver' });
    expect(parseCity('atlanta')).toEqual({ kind: 'pack', id: 'atlanta' });
    expect(parseCity('39.74,-104.99')).toEqual({ kind: 'coords', at: [-104.99, 39.74] });
    expect(parseCity(' 33.7 , -84.4 ')).toEqual({ kind: 'coords', at: [-84.4, 33.7] });
    expect(parseCity('91,0')).toBeNull();
    expect(parseCity('0,181')).toBeNull();
    expect(parseCity('boston')).toBeNull();
    expect(parseCity('<script>')).toBeNull();
    expect(parseCity(null)).toBeNull();
  });

  it('accepts only theme presets', () => {
    for (const t of ['tactical', 'greenred', 'nightvision', 'amber', 'redlight', 'steel']) expect(parseTheme(t)).toBe(t);
    expect(parseTheme('custom')).toBeNull();
    expect(parseTheme('constructor')).toBeNull();
    expect(parseTheme('AMBER')).toBe('amber');
  });

  it('builds embed URLs', () => {
    expect(embedUrl('https://x.dev/vigilante', { view: 'map', city: '39.7,-105', theme: 'amber' })).toBe('https://x.dev/vigilante/embed.html?view=map&city=39.7%2C-105&theme=amber');
    expect(embedUrl('https://x.dev/', {})).toBe('https://x.dev/embed.html');
  });
});

describe('embed.js loader', () => {
  const code = readFileSync(resolve(process.cwd(), 'web/public/embed.js'), 'utf8');
  const run = () => new Function(code)();

  it('injects one sandboxed, responsive iframe after the tag', () => {
    document.body.innerHTML = '';
    const s = document.createElement('script');
    s.setAttribute('src', 'https://r0n1n9.github.io/vigilante/embed.js');
    Object.assign(s.dataset, { city: 'atlanta', view: 'map', theme: 'amber', height: '500' });
    document.body.appendChild(s);
    run();
    run(); // loading twice doesn't double-mount
    const frames = document.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect(f.src).toBe('https://r0n1n9.github.io/vigilante/embed.html?view=map&city=atlanta&theme=amber');
    expect(f.getAttribute('sandbox')).toContain('allow-scripts');
    expect(f.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(f.style.width).toBe('100%');
    expect(f.style.height).toBe('500px');
    expect(s.nextSibling).toBe(f);
  });

  it('drops invalid options', () => {
    run();
    const src = (window as unknown as { VigilanceEmbed: { src: (b: string, o: object) => string } }).VigilanceEmbed.src;
    expect(src('https://a.dev/v/', { city: '"><img onerror=x>', view: 'sky', theme: 'pink' })).toBe('https://a.dev/v/embed.html');
    expect(src('https://a.dev/v', { city: '39.7, -105.0' })).toBe('https://a.dev/v/embed.html?city=39.7%2C-105.0');
    // Loader and app agree on what's valid.
    expect(parseCity('39.7,-105.0')).not.toBeNull();
  });
});

describe('web fallbacks', () => {
  it('sends the same Claude request as the Rust core, plus the browser header', () => {
    const { url, init } = aiRequest(' sk-test ', '{"a":1}');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const h = init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-test');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(h['anthropic-version']).toBe('2026-10-21');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(4000);
    expect(body.messages[0].content).toBe('Current snapshot:\n{"a":1}');
    expect(init.credentials).toBe('omit');
  });

  it('reads Claude responses like ai.rs', () => {
    expect(aiResult(200, { content: [{ type: 'thinking' }, { type: 'text', text: '- one' }, { type: 'text', text: 'Watch for: two' }] })).toBe('- one\nWatch for: two');
    expect(() => aiResult(401, { error: { message: 'invalid x-api-key' } })).toThrow('Claude API 401: invalid x-api-key');
    expect(() => aiResult(200, { stop_reason: 'refusal', content: [] })).toThrow('declined');
    expect(() => aiResult(200, { content: [] })).toThrow('empty response');
  });

  it('publishes ntfy messages as JSON', () => {
    expect(ntfyJson({ server: 'https://ntfy.sh', topic: 't', title: 'Tornado · warning', message: 'm', priority: 5, tags: 'warning, rotating_light', click: 'https://x' })).toEqual({
      topic: 't',
      title: 'Tornado · warning',
      message: 'm',
      priority: 5,
      tags: ['warning', 'rotating_light'],
      click: 'https://x',
    });
  });
});

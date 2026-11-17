import { describe, expect, it } from 'vitest';
import { CRITICAL, DEFAULT_APPEARANCE, hexToRgb, rgbToHex, severityColors, THEMES, themeVars, withTheme } from '../src/lib/theme';
import { withDefaults } from '../src/lib/settings';

describe('theme', () => {
  it('converts between hex and RGB', () => {
    expect(hexToRgb('#3dd6f5')).toEqual([61, 214, 245]);
    expect(rgbToHex(61, 214, 245)).toBe('#3dd6f5');
    expect(rgbToHex(300, -4, 12.6)).toBe('#ff000d');
    expect(hexToRgb('nonsense')).toEqual([61, 214, 245]);
  });

  it('presets copy colors; custom keeps the current ones', () => {
    const amber = withTheme(DEFAULT_APPEARANCE, 'amber');
    expect(amber.accent).toBe(THEMES.amber.accent);
    const custom = withTheme({ ...amber, accent: '#123456' }, 'custom');
    expect(custom.accent).toBe('#123456');
  });

  it('produces CSS variables with clamped opacity', () => {
    const v = themeVars({ ...DEFAULT_APPEARANCE, accent: '#ff0000', panelOpacity: 0.1, texture: false });
    expect(v['--accent-rgb']).toBe('255, 0, 0');
    expect(v['--panel-a']).toBe('0.40');
    expect(v['--texture']).toBe('0');
  });

  it('old settings files get the default appearance', () => {
    expect(withDefaults({}).appearance).toEqual(DEFAULT_APPEARANCE);
    expect(withDefaults({ appearance: { ...DEFAULT_APPEARANCE, panelOpacity: 0.6 } }).appearance.panelOpacity).toBe(0.6);
  });
});

describe('alert color', () => {
  it('drives the warning and serious steps; critical never changes', () => {
    const [, info, warn, hot, crit] = severityColors('#ff5a4a');
    expect(info).toBe('#4c8dff');
    expect(warn).toBe('#ff5a4a');
    expect(crit).toBe(CRITICAL);
    expect(hot).not.toBe(warn);
    expect(severityColors('#ffb020')[2]).toBe('#ffb020');
  });

  it('exposes it as CSS variables and keeps it through presets', () => {
    const v = themeVars(withTheme(DEFAULT_APPEARANCE, 'greenred'));
    expect(v['--warn']).toBe(THEMES.greenred.alert);
    expect(v['--warn-rgb']).toBe('255, 90, 74');
    expect(v['--accent']).toBe(THEMES.greenred.accent);
    expect(themeVars(DEFAULT_APPEARANCE)['--warn']).toBe('#ffb020');
  });

  it('fills in an alert color for settings saved before it existed', () => {
    const old = { theme: 'nightvision', accent: '#39ff7a', bg: '#060b07', panel: '#0a120c', panelOpacity: 0.9, texture: true };
    expect(withDefaults({ appearance: old as never }).appearance.alert).toBe('#ffb020');
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, hexToRgb, rgbToHex, THEMES, themeVars, withTheme } from '../src/lib/theme';
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

describe('alert colors', () => {
  it('emit warn, crit and a blended serious color', () => {
    const v = themeVars({ ...DEFAULT_APPEARANCE, alert: '#ff0000', critical: '#0000ff' });
    expect(v['--warn-rgb']).toBe('255, 0, 0');
    expect(v['--crit-rgb']).toBe('0, 0, 255');
    expect(v['--serious']).toBe('#800080');
  });
  it('the green & red preset swaps amber for red', () => {
    const g = withTheme(DEFAULT_APPEARANCE, 'greenred');
    expect(g.accent).toBe(THEMES.greenred.accent);
    expect(g.alert).toBe(THEMES.greenred.alert);
    expect(withDefaults({ appearance: { ...DEFAULT_APPEARANCE, alert: undefined as unknown as string } }).appearance.alert).toBeUndefined;
  });
});

describe('Netrunner skin', () => {
  it('sets the skin attribute only for the Netrunner preset', async () => {
    const { applyAppearance } = await import('../src/lib/theme');
    const root = { style: { setProperty() {} }, dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyAppearance(withTheme(DEFAULT_APPEARANCE, 'netrunner'), root);
    expect(root.dataset.skin).toBe('netrunner');
    applyAppearance(withTheme(DEFAULT_APPEARANCE, 'fieldmanual'), root);
    expect(root.dataset.skin).toBe('fieldmanual');
    applyAppearance(withTheme(DEFAULT_APPEARANCE, 'tactical'), root);
    expect(root.dataset.skin).toBeUndefined();
    applyAppearance({ ...withTheme(DEFAULT_APPEARANCE, 'netrunner'), theme: 'custom' }, root);
    expect(root.dataset.skin).toBeUndefined();
  });
});

it('lists the extra looks after the classic presets, in order', () => {
  expect(Object.keys(THEMES).slice(-2)).toEqual(['netrunner', 'fieldmanual']);
  expect(DEFAULT_APPEARANCE.theme).toBe('tactical');
});

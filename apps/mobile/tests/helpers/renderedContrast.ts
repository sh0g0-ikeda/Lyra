import type { ReactTestInstance } from 'react-test-renderer';

export interface Rgba { red: number; green: number; blue: number; alpha: number }

export function parseColor(value: string): Rgba {
  if (value === 'transparent') return { red: 0, green: 0, blue: 0, alpha: 0 };
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex !== null) {
    return { red: parseInt(hex[1].slice(0, 2), 16), green: parseInt(hex[1].slice(2, 4), 16), blue: parseInt(hex[1].slice(4, 6), 16), alpha: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgba === null) throw new Error(`Unsupported test color: ${value}`);
  return { red: Number(rgba[1]), green: Number(rgba[2]), blue: Number(rgba[3]), alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
}

export function composite(front: Rgba, back: Rgba): Rgba {
  const alpha = front.alpha + back.alpha * (1 - front.alpha);
  if (alpha === 0) return parseColor('transparent');
  const channel = (foreground: number, background: number): number =>
    (foreground * front.alpha + background * back.alpha * (1 - front.alpha)) / alpha;
  return { red: channel(front.red, back.red), green: channel(front.green, back.green), blue: channel(front.blue, back.blue), alpha };
}

export function contrastRatio(first: Rgba, second: Rgba): number {
  // WCAG 2.2 relative luminance: composite in sRGB before linearizing channels.
  const linear = (value: number): number => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (color: Rgba): number => 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue);
  const left = luminance(first);
  const right = luminance(second);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

export function renderedStyle(value: unknown, pressed = false): Record<string, unknown> {
  if (typeof value === 'function') return renderedStyle(value({ pressed }), pressed);
  if (Array.isArray(value)) return Object.assign({}, ...value.map((entry) => renderedStyle(entry, pressed)));
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function renderedColors(node: ReactTestInstance, foreground?: string, pressed = false): { foreground: Rgba; background: Rgba } {
  const value = foreground ?? renderedStyle(node.props.style, pressed).color;
  if (typeof value !== 'string') throw new Error('Expected an explicit text/placeholder/border color');
  let front = parseColor(value);
  let back = parseColor('transparent');
  // Composite only host nodes, avoiding double-counting a mock component's props.
  for (let current: ReactTestInstance | null = node; current !== null; current = current.parent) {
    if (typeof current.type !== 'string') continue;
    const style = renderedStyle(current.props.style, pressed);
    const surface = parseColor(typeof style.backgroundColor === 'string' ? style.backgroundColor : 'transparent');
    const opacity = typeof style.opacity === 'number' ? style.opacity : 1;
    front = composite(front, surface);
    back = composite(back, surface);
    front.alpha *= opacity;
    back.alpha *= opacity;
  }
  if (front.alpha !== 1 || back.alpha !== 1) throw new Error('Render a known opaque ancestor for contrast measurement');
  return { foreground: front, background: back };
}

export function renderedContrast(node: ReactTestInstance, foreground?: string, pressed = false): number {
  const pixels = renderedColors(node, foreground, pressed);
  return contrastRatio(pixels.foreground, pixels.background);
}

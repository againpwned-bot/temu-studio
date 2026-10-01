import { hexToRgb } from '../utils/color.js';
import { springEasing } from '../utils/spring.js';

/** Replaces the CSS fallback curves with real sampled springs where linear() is supported. */
export function installSpringEasings() {
  if (!CSS.supports('transition-timing-function', 'linear(0, 1)')) return;
  const root = document.documentElement.style;
  const bouncy = springEasing({ stiffness: 260, damping: 15 });
  const soft = springEasing({ stiffness: 170, damping: 19 });
  root.setProperty('--spring', bouncy.easing);
  root.setProperty('--spring-dur', `${bouncy.duration}ms`);
  root.setProperty('--spring-soft', soft.easing);
  root.setProperty('--spring-soft-dur', `${soft.duration}ms`);
}

export function applyTheme(v) {
  const root = document.documentElement;
  const s = root.style;
  const glass = hexToRgb(v.glassTint);
  s.setProperty('--accent', v.accent);
  s.setProperty('--accent-2', v.accent2);
  s.setProperty('--text', v.text);
  s.setProperty('--glass-rgb', `${glass.r} ${glass.g} ${glass.b}`);
  s.setProperty('--glass-alpha', String(v.glassAlpha));
  s.setProperty('--glass-blur', `${v.glassBlur}px`);
  s.setProperty('--radius', `${v.radius}px`);
  s.setProperty('--font-body', `'${v.font}', system-ui, -apple-system, 'Segoe UI', sans-serif`);
  s.setProperty('--font-display', `'${v.displayFont}', '${v.font}', system-ui, sans-serif`);
  s.setProperty('--ui-scale', String(v.uiScale));
  s.setProperty('--sky-top', v.skyTop);
  s.setProperty('--sky-mid', v.skyMid);
  s.setProperty('--sky-horizon', v.skyHorizon);
  root.classList.toggle('reduce-motion', v.reduceMotion);
  root.classList.toggle('has-sun', v.sun);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', v.skyTop);
}

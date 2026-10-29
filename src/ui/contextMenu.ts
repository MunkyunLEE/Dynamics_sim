import { h } from './dom';

export interface MenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  header?: boolean;
}

let current: HTMLElement | null = null;

export function closeMenu(): void {
  current?.remove();
  current = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeMenu);
}

function onOutside(e: Event): void {
  if (current && !current.contains(e.target as Node)) closeMenu();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeMenu();
}

export function showMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  const menu = h('div', { class: 'ctx-menu' });
  for (const it of items) {
    if (it.separator) {
      menu.append(h('div', { class: 'ctx-sep' }));
    } else if (it.header) {
      menu.append(h('div', { class: 'ctx-header' }, it.label));
    } else {
      menu.append(
        h(
          'button',
          {
            class: 'ctx-item',
            type: 'button',
            disabled: it.disabled === true,
            onclick: () => {
              closeMenu();
              it.action?.();
            }
          },
          it.label
        )
      );
    }
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  current = menu;
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeMenu);
}

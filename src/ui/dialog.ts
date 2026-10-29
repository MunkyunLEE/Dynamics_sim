import { h } from './dom';

export interface DialogButton {
  label: string;
  primary?: boolean;
  onClick?: () => boolean | void;
}

export function openDialog(title: string, body: HTMLElement, buttons: DialogButton[]): () => void {
  const error = h('div', { class: 'dialog-error' });
  const overlay = h('div', { class: 'dialog-overlay' });

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  const footer = h('div', { class: 'dialog-footer' });
  for (const b of buttons) {
    footer.append(
      h(
        'button',
        {
          class: b.primary ? 'btn primary' : 'btn',
          type: 'button',
          onclick: () => {
            error.textContent = '';
            try {
              if (b.onClick?.() === false) return;
            } catch (err) {
              error.textContent = err instanceof Error ? err.message : String(err);
              return;
            }
            close();
          }
        },
        b.label
      )
    );
  }

  overlay.append(h('div', { class: 'dialog' }, h('h2', {}, title), body, error, footer));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  const first = overlay.querySelector('input, select') as HTMLElement | null;
  first?.focus();
  return close;
}

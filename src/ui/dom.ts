export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k in el) {
      try {
        (el as unknown as Record<string, unknown>)[k] = v;
      } catch {
        el.setAttribute(k, String(v));
      }
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return '';
  return String(Number(v.toPrecision(6)));
}

export function numInput(value: number | null, extra: Record<string, unknown> = {}): HTMLInputElement {
  return h('input', { type: 'number', step: 'any', value: value === null ? '' : fmt(value), ...extra });
}

export function readNum(input: HTMLInputElement): number {
  return input.value.trim() === '' ? NaN : Number(input.value);
}

export function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'row' }, h('span', { class: 'row-label' }, label), control, hint ? h('span', { class: 'row-hint' }, hint) : null);
}

export function selectOf(options: [string, string][], value?: string): HTMLSelectElement {
  const sel = h('select');
  for (const [v, label] of options) sel.append(h('option', { value: v }, label));
  if (value !== undefined) sel.value = value;
  return sel;
}

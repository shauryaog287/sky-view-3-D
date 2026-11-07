import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/** Accessible modal sheet (bottom sheet on phones, centred dialog on tablets). Esc and backdrop close it. */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren; testId?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')].filter((x) => !x.hasAttribute('disabled'));
        if (!items.length) return;
        const [a, z] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    addEventListener('keydown', onKey, true);
    return () => {
      removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`sheet ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} ref={ref} data-testid={props.testId}>
        <div class="sheet-head">
          <h2>{props.title}</h2>
          <button class="icon-btn small" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div class="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

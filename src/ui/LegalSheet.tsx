import { useEffect, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { legalPage } from '../state/legal';
import { appConfig } from '../state/entitlements';

const TITLES = { privacy: 'Privacy policy', terms: 'Terms of use', sources: 'Data sources & attribution' } as const;

/** Shows the static legal pages (public/legal/*.html, also reachable without JS) inside the app. */
export function LegalSheet() {
  const page = legalPage.value;
  const [html, setHtml] = useState<string>('');
  useEffect(() => {
    if (!page) return;
    setHtml('');
    fetch(`/legal/${page}.html`)
      .then((r) => r.text())
      .then((t) => {
        // Our own static file: keep only <main>, drop its navigation.
        const doc = new DOMParser().parseFromString(t, 'text/html');
        doc.querySelector('nav')?.remove();
        doc.querySelector('h1')?.remove();
        setHtml(doc.querySelector('main')?.innerHTML ?? '');
      })
      .catch(() => setHtml('<p>Could not load this page. You may be offline.</p>'));
  }, [page]);
  if (!page) return null;
  const providers = appConfig.value?.providers ?? [];
  return (
    <Sheet title={TITLES[page]} onClose={() => (legalPage.value = null)} wide testId={`legal-${page}`}>
      {page === 'sources' && providers.length > 0 && (
        <p class="note">
          Live flight data right now: {providers.map((p) => p.attribution).join(' · ')}
          {providers.some((p) => !p.commercialUseAllowed) && ' (non-commercial terms)'}
        </p>
      )}
      <div class="legal-body" dangerouslySetInnerHTML={{ __html: html || '<p>Loading…</p>' }} />
      <p class="fineprint">
        <a href={`/legal/${page}.html`} target="_blank" rel="noopener">
          Open as a web page
        </a>
      </p>
    </Sheet>
  );
}

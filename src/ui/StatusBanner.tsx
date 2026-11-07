import { baseLayerStatus, toasts, webglError } from '../state/store';

const LAYER_LABEL = {
  google3d: 'Photorealistic 3D',
  ion: 'Terrain + imagery',
  offline: 'Basic globe',
} as const;

export function LayerBadge() {
  const s = baseLayerStatus.value;
  return (
    <div class={`layer-badge layer-${s.kind}`} title={s.reason ?? ''} data-testid="layer-badge">
      <span class="dot" aria-hidden="true" />
      {LAYER_LABEL[s.kind]}
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function WebglErrorScreen() {
  if (!webglError.value) return null;
  return (
    <div class="fatal" role="alert">
      <h1>3D isn't available</h1>
      <p>{webglError.value}</p>
    </div>
  );
}

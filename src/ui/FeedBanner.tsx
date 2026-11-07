import { feedStatus } from '../scene/liveFeed';

/** One-line status for the live data: errors, provider outages, coverage gaps, zoom hints. */
export function FeedBanner() {
  const s = feedStatus.value;
  let text: string | undefined;
  let tone: 'info' | 'warn' | 'error' = 'info';
  if (s.state === 'error') {
    tone = 'error';
    text = s.notice === 'offline' ? "You're offline — showing the last known positions." : `Live data unavailable: ${s.error ?? 'server error'}. Retrying…`;
  } else if (s.notice === 'providers_down') {
    tone = 'error';
    text = 'Flight data providers are not responding. Retrying…';
  } else if (s.notice === 'zoom_in') {
    text = 'Showing flights near the centre of the view — zoom in to see more.';
  } else if (s.notice === 'no_aircraft' && s.state === 'ok') {
    tone = 'warn';
    text = 'No aircraft reported here. Coverage is limited over oceans and remote areas.';
  } else if (s.stale) {
    tone = 'warn';
    text = 'Live data is delayed (provider rate limit). Positions are estimated.';
  }
  if (!text) return null;
  return (
    <div class={`banner banner-${tone}`} role="status" data-testid="feed-banner">
      {text}
    </div>
  );
}

export function FlightCount() {
  const s = feedStatus.value;
  if (s.state === 'idle') return null;
  return (
    <div class="layer-badge" data-testid="flight-count" title="Aircraft in view">
      <span class="dot" style={{ background: s.state === 'error' ? 'var(--red)' : 'var(--green)' }} aria-hidden="true" />
      <span class="num">{s.count}</span> flights
    </div>
  );
}

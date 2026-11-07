import { GlobeView } from './ui/GlobeView';
import { LayerBadge, Toasts, WebglErrorScreen } from './ui/StatusBanner';
import { FeedBanner, FlightCount } from './ui/FeedBanner';

export function App() {
  return (
    <div class="app">
      <GlobeView />
      <header class="topbar">
        <div class="brand" aria-label="SkyView 3D">
          <span class="brand-mark" aria-hidden="true">✈</span>
          <span class="brand-name">SkyView 3D</span>
        </div>
        <FlightCount />
        <LayerBadge />
      </header>
      <FeedBanner />
      <Toasts />
      <WebglErrorScreen />
    </div>
  );
}

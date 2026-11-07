import { GlobeView } from './ui/GlobeView';
import { LayerBadge, Toasts, WebglErrorScreen } from './ui/StatusBanner';
import { FeedBanner, FlightCount } from './ui/FeedBanner';
import { InfoPanel } from './ui/InfoPanel';
import { SearchBox } from './ui/SearchBox';
import { PinnedBar } from './ui/PinnedBar';

export function App() {
  return (
    <div class="app">
      <GlobeView />
      <header class="topbar">
        <div class="brand" aria-label="SkyView 3D">
          <span class="brand-mark" aria-hidden="true">✈</span>
          <span class="brand-name">SkyView 3D</span>
        </div>
        <SearchBox />
        <FlightCount />
        <LayerBadge />
      </header>
      <FeedBanner />
      <InfoPanel />
      <PinnedBar />
      <Toasts />
      <WebglErrorScreen />
    </div>
  );
}

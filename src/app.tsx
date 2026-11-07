import { GlobeView } from './ui/GlobeView';
import { LayerBadge, Toasts, WebglErrorScreen } from './ui/StatusBanner';
import { FeedBanner, FlightCount } from './ui/FeedBanner';
import { InfoPanel } from './ui/InfoPanel';
import { SearchBox } from './ui/SearchBox';
import { PinnedBar } from './ui/PinnedBar';
import { SettingsSheet } from './ui/SettingsSheet';
import { ReplayBar } from './ui/ReplayBar';
import { AlertSheet } from './ui/AlertSheet';
import { AccountSheet } from './ui/AccountSheet';
import { UpsellSheet, MockCheckoutSheet } from './ui/UpsellSheet';
import { AdSlot } from './ui/AdSlot';
import { settingsOpen } from './state/settings';

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
        <button class="icon-btn" aria-label="Settings" onClick={() => (settingsOpen.value = true)} data-testid="open-settings">
          ⚙
        </button>
      </header>
      <FeedBanner />
      <InfoPanel />
      <PinnedBar />
      <ReplayBar />
      <SettingsSheet />
      <AlertSheet />
      <AccountSheet />
      <UpsellSheet />
      <MockCheckoutSheet />
      <AdSlot placement="map-corner" />
      <Toasts />
      <WebglErrorScreen />
    </div>
  );
}

import { MapProvider } from 'react-map-gl/maplibre';
import { MapComponent } from './components/map';
import { RoutePlanner } from './components/route-planner';
import { SettingsPanel } from './components/settings-panel/settings-panel';
import { Toaster } from '@/components/ui/sonner';
import { isEmbedMode } from '@/utils/embed-mode';

export const App = () => {
  return (
    <MapProvider>
      <MapComponent />
      <RoutePlanner />
      {!isEmbedMode && <SettingsPanel />}
      {!isEmbedMode && (
        <Toaster position="bottom-center" duration={5000} richColors />
      )}
    </MapProvider>
  );
};

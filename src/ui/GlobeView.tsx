import { useEffect, useRef } from 'preact/hooks';
import { SceneController, setScene } from '../scene/controller';
import { sceneReady, webglError } from '../state/store';

export function GlobeView() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let controller: SceneController | null = null;
    try {
      controller = new SceneController(ref.current);
      setScene(controller);
      void controller.start().finally(() => (sceneReady.value = true));
    } catch (err) {
      console.error(err);
      webglError.value =
        'Your browser could not start 3D rendering (WebGL). Try updating Chrome or enabling hardware acceleration.';
    }
    return () => {
      controller?.destroy();
      setScene(null);
    };
  }, []);

  return <div ref={ref} class="globe" data-testid="globe" aria-label="3D globe with live aircraft" role="application" />;
}

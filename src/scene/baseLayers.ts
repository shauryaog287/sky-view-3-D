import {
  type Viewer,
  type Cesium3DTileset,
  ImageryLayer,
  TileMapServiceImageryProvider,
  EllipsoidTerrainProvider,
  Terrain,
  buildModuleUrl,
  createGooglePhotorealistic3DTileset,
  CustomShader,
  UniformType,
  LightingModel,
} from 'cesium';

export type BaseLayerKind = 'google3d' | 'ion' | 'offline';

export interface BaseLayerStatus {
  kind: BaseLayerKind;
  /** Why we are not on the best layer (missing key, quota reached, error...). */
  reason?: string;
}

export interface GoogleTilesConfig {
  /** Direct Google Map Tiles API key. If absent but ionToken is set, Google tiles are streamed through Cesium ion. */
  googleKey?: string;
  ionToken?: string;
  /** Result of the backend session-cap check. */
  allowed: boolean;
  deniedReason?: string;
  /** Tileset memory budget. */
  cacheBytes?: number;
  maximumScreenSpaceError?: number;
}

type Listener = (s: BaseLayerStatus) => void;

/**
 * Layered world: Google Photorealistic 3D Tiles → Cesium ion World Terrain + imagery → offline Natural Earth globe.
 *
 * Billing note: every Google root tileset request starts a billable session. We create the tileset exactly once
 * per viewing session and only hide/show it afterwards; it is never re-created on camera moves.
 */
export class BaseLayers {
  private google?: Cesium3DTileset;
  private status: BaseLayerStatus = { kind: 'offline' };
  private listeners = new Set<Listener>();
  private failureCount = 0;
  private offlineLayer?: ImageryLayer;
  private ionLayer?: ImageryLayer;
  readonly brightness = { value: 1.0 };
  private readonly tintShader = new CustomShader({
    lightingModel: LightingModel.UNLIT,
    uniforms: {
      u_brightness: { type: UniformType.FLOAT, value: 1.0 },
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        material.diffuse *= u_brightness;
      }
    `,
  });

  constructor(private readonly viewer: Viewer) {}

  get current(): BaseLayerStatus {
    return this.status;
  }

  get googleTileset(): Cesium3DTileset | undefined {
    return this.status.kind === 'google3d' ? this.google : undefined;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: BaseLayerStatus) {
    this.status = s;
    for (const l of this.listeners) l(s);
  }

  /** Day/night dimming of photoreal tiles (they have baked lighting, so we scale their colour). */
  setTileBrightness(v: number) {
    this.tintShader.setUniform('u_brightness', v);
  }

  async init(cfg: GoogleTilesConfig): Promise<BaseLayerStatus> {
    // Always have the offline globe underneath so something renders immediately and without network.
    this.useOffline();
    if (cfg.allowed && (cfg.googleKey || cfg.ionToken)) {
      const ok = await this.useGoogle(cfg);
      if (ok) return this.status;
    }
    const reason = !cfg.allowed
      ? cfg.deniedReason ?? 'Photorealistic tiles limit reached for today'
      : !cfg.googleKey && !cfg.ionToken
        ? 'No Google Maps / Cesium ion key configured'
        : 'Photorealistic tiles unavailable';
    if (cfg.ionToken) {
      const ok = await this.useIon(reason);
      if (ok) return this.status;
    }
    this.set({ kind: 'offline', reason });
    return this.status;
  }

  private async useGoogle(cfg: GoogleTilesConfig): Promise<boolean> {
    try {
      if (!this.google) {
        this.google = await createGooglePhotorealistic3DTileset(
          // We ship no geocoder at all, so no non-Google geocoder is ever used with these tiles.
          { key: cfg.googleKey, onlyUsingWithGoogleGeocoder: true },
          {
            cacheBytes: cfg.cacheBytes ?? 512 * 1024 * 1024,
            maximumCacheOverflowBytes: 256 * 1024 * 1024,
            maximumScreenSpaceError: cfg.maximumScreenSpaceError ?? 16,
            showCreditsOnScreen: true,
            enableCollision: true,
            preloadFlightDestinations: true,
            foveatedScreenSpaceError: true,
          },
        );
        this.google.customShader = this.tintShader;
        this.google.tileFailed.addEventListener((e: { url: string; message: string }) => {
          this.failureCount++;
          const quota = /429|403|quota|RESOURCE_EXHAUSTED/i.test(e.message ?? '');
          if (quota || this.failureCount > 25) {
            void this.fallbackFromGoogle(quota ? 'Photorealistic tiles quota reached' : 'Photorealistic tiles failing');
          }
        });
        this.viewer.scene.primitives.add(this.google);
      }
      this.google.show = true;
      // Google tiles cover the whole planet; hide the ellipsoid globe to avoid z-fighting and save GPU.
      this.viewer.scene.globe.show = false;
      this.set({ kind: 'google3d' });
      return true;
    } catch (err) {
      console.warn('[tiles] Google Photorealistic 3D Tiles failed, falling back', err);
      return false;
    }
  }

  private async fallbackFromGoogle(reason: string) {
    if (this.status.kind !== 'google3d') return;
    if (this.google) this.google.show = false;
    this.viewer.scene.globe.show = true;
    const ok = await this.useIon(reason);
    if (!ok) this.set({ kind: 'offline', reason });
  }

  private async useIon(reason?: string): Promise<boolean> {
    try {
      const { scene, imageryLayers } = this.viewer;
      if (!this.ionLayer) {
        this.ionLayer = ImageryLayer.fromWorldImagery({});
        imageryLayers.add(this.ionLayer);
      }
      const terrain = Terrain.fromWorldTerrain({ requestWaterMask: false, requestVertexNormals: true });
      scene.setTerrain(terrain);
      await new Promise<void>((resolve, reject) => {
        terrain.readyEvent.addEventListener(() => resolve());
        terrain.errorEvent.addEventListener((e: unknown) => reject(e));
      });
      scene.globe.show = true;
      this.set({ kind: 'ion', reason });
      return true;
    } catch (err) {
      console.warn('[tiles] Cesium ion terrain/imagery failed, using offline globe', err);
      this.viewer.scene.terrainProvider = new EllipsoidTerrainProvider();
      if (this.ionLayer) {
        this.viewer.imageryLayers.remove(this.ionLayer, true);
        this.ionLayer = undefined;
      }
      return false;
    }
  }

  private useOffline() {
    const { imageryLayers, scene } = this.viewer;
    if (!this.offlineLayer) {
      // Natural Earth II ships inside Cesium's static assets: no key, no network beyond our own origin.
      this.offlineLayer = ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
        {},
      );
      imageryLayers.add(this.offlineLayer, 0);
    }
    scene.terrainProvider = new EllipsoidTerrainProvider();
    scene.globe.show = true;
  }
}

import {
  type Viewer,
  Cesium3DTileset,
  ImageryLayer,
  TileMapServiceImageryProvider,
  EllipsoidTerrainProvider,
  Terrain,
  buildModuleUrl,
  createGooglePhotorealistic3DTileset,
  CustomShader,
  UniformType,
  LightingModel,
  Cartesian3,
  ArcGisMapServerImageryProvider,
  Credit,
  Resource,
} from 'cesium';

export type BaseLayerKind = 'google3d' | 'ion' | 'satellite' | 'offline';

/** Esri World Imagery (sub-metre satellite/aerial imagery at major airports). Keyless for non-commercial use. */
export const ESRI_WORLD_IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

export interface BaseLayerStatus {
  kind: BaseLayerKind;
  /** Why we are not on the best layer (missing key, quota reached, error...). */
  reason?: string;
}

export interface GoogleTilesConfig {
  /** Direct Google Map Tiles API key. If absent but ionToken is set, Google tiles are streamed through Cesium ion. */
  googleKey?: string;
  ionToken?: string;
  /** Optional ArcGIS Location Platform key for the satellite layer (required for commercial use). */
  arcgisKey?: string;
  /** Allow the keyless satellite imagery layer when Google / ion are unavailable. */
  satellite?: boolean;
  /** Result of the backend session-cap check. */
  allowed: boolean;
  deniedReason?: string;
  /**
   * Mock mode only: a local stand-in tileset used instead of Google's, so the photoreal code paths (airport clipping,
   * flat 2D map) can be exercised without a key.
   */
  testTilesetUrl?: string;
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
  private satelliteLayer?: ImageryLayer;
  private satelliteCredit?: Credit;
  private readonly tintShader = new CustomShader({
    lightingModel: LightingModel.UNLIT,
    uniforms: {
      u_brightness: { type: UniformType.FLOAT, value: 1.0 },
      u_tint: { type: UniformType.VEC3, value: new Cartesian3(1, 1, 1) },
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        material.diffuse *= u_brightness * u_tint;
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

  /** Day/night dimming + tint of photoreal tiles (they have baked daylight, so we scale their colour). */
  setTileTone(brightness: number, tint: [number, number, number]) {
    this.tintShader.setUniform('u_brightness', brightness);
    this.tintShader.setUniform('u_tint', new Cartesian3(tint[0], tint[1], tint[2]));
  }

  async init(cfg: GoogleTilesConfig): Promise<BaseLayerStatus> {
    // Always have the offline globe underneath so something renders immediately and without network.
    this.useOffline();
    this.lastArcgisKey = cfg.arcgisKey;
    if (cfg.allowed && (cfg.googleKey || cfg.ionToken || cfg.testTilesetUrl)) {
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
    if (cfg.satellite !== false) {
      const ok = await this.useSatellite(cfg.arcgisKey, reason);
      if (ok) return this.status;
    }
    this.set({ kind: 'offline', reason });
    return this.status;
  }

  /** Switch to Google tiles later in the session (e.g. after an upgrade). Keeps the current layer on failure. */
  async tryGoogle(cfg: GoogleTilesConfig): Promise<boolean> {
    if (this.status.kind === 'google3d') return true;
    if (!cfg.googleKey && !cfg.ionToken) return false;
    return this.useGoogle(cfg);
  }

  private async useGoogle(cfg: GoogleTilesConfig): Promise<boolean> {
    try {
      if (!this.google) {
        const opts = {
          cacheBytes: cfg.cacheBytes ?? 512 * 1024 * 1024,
          maximumCacheOverflowBytes: 256 * 1024 * 1024,
          maximumScreenSpaceError: cfg.maximumScreenSpaceError ?? 16,
          showCreditsOnScreen: true,
          enableCollision: true,
          preloadFlightDestinations: true,
          foveatedScreenSpaceError: true,
        };
        this.google = cfg.testTilesetUrl
          ? await Cesium3DTileset.fromUrl(cfg.testTilesetUrl, opts)
          : await createGooglePhotorealistic3DTileset(
              // We ship no geocoder at all, so no non-Google geocoder is ever used with these tiles.
              { key: cfg.googleKey, onlyUsingWithGoogleGeocoder: true },
              opts,
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
      // Google tiles cover the whole planet; hide the ellipsoid globe to avoid z-fighting and save GPU. (With
      // "3D at airports only" the PhotorealScope clips the tiles and shows the globe as the flat 2D map instead.)
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
    const ok = (await this.useIon(reason)) || (await this.useSatellite(this.lastArcgisKey, reason));
    if (!ok) this.set({ kind: 'offline', reason });
  }

  private lastArcgisKey?: string;

  /**
   * The flat 2D satellite map shown around photoreal airports ("3D at airports only"). Loads the Esri layer on first
   * use; the offline globe stays underneath while it loads.
   */
  showFlatImagery(on: boolean) {
    if (!on) {
      if (this.satelliteLayer && this.status.kind === 'google3d') this.satelliteLayer.show = false;
      return;
    }
    if (this.satelliteLayer) {
      this.satelliteLayer.show = true;
      return;
    }
    if (this.loadingFlat) return;
    this.loadingFlat = true;
    const url = new Resource({ url: ESRI_WORLD_IMAGERY, queryParameters: this.lastArcgisKey ? { token: this.lastArcgisKey } : undefined });
    void ArcGisMapServerImageryProvider.fromUrl(url, { enablePickFeatures: false })
      .then((provider) => {
        if (this.satelliteLayer) return;
        this.satelliteLayer = this.viewer.imageryLayers.addImageryProvider(provider);
        this.satelliteCredit = new Credit('Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community', true);
        this.viewer.creditDisplay.addStaticCredit(this.satelliteCredit);
      })
      .catch((e) => console.warn('[tiles] satellite imagery unavailable for the 2D map', e))
      .finally(() => (this.loadingFlat = false));
  }

  private loadingFlat = false;

  /**
   * Real satellite/aerial imagery on the ellipsoid: airports show their actual runways, taxiways, aprons and terminal
   * roofs. Layered above the offline globe, so failed tiles simply show Natural Earth underneath.
   */
  private async useSatellite(arcgisKey: string | undefined, reason?: string): Promise<boolean> {
    this.lastArcgisKey = arcgisKey;
    try {
      if (!this.satelliteLayer) {
        const url = new Resource({ url: ESRI_WORLD_IMAGERY, queryParameters: arcgisKey ? { token: arcgisKey } : undefined });
        const provider = await ArcGisMapServerImageryProvider.fromUrl(url, { enablePickFeatures: false });
        this.satelliteLayer = this.viewer.imageryLayers.addImageryProvider(provider);
        this.satelliteCredit = new Credit('Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community', true);
        this.viewer.creditDisplay.addStaticCredit(this.satelliteCredit);
      }
      this.satelliteLayer.show = true;
      this.viewer.scene.terrainProvider = new EllipsoidTerrainProvider();
      this.viewer.scene.globe.show = true;
      this.set({ kind: 'satellite', reason });
      return true;
    } catch (err) {
      console.warn('[tiles] satellite imagery unavailable, using offline globe', err);
      return false;
    }
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

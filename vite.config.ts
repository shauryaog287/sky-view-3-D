import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { VitePWA } from 'vite-plugin-pwa';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
// Cesium needs its Workers, Assets, ThirdParty and Widgets folders served as static files.
const cesiumBaseUrl = 'cesiumStatic';

export default defineConfig(({ mode }) => ({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  plugins: [
    preact(),
    viteStaticCopy({
      targets: [
        {
          src: `${cesiumSource}/{Workers,ThirdParty,Assets,Widgets}/**/*`,
          dest: cesiumBaseUrl,
          rename: { stripBase: 4 },
        },
      ],
    }),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        // The main chunk contains CesiumJS (~4 MB); the shell is useless without it.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Aircraft models (one per type, ~100 KB each) are cached on first use instead of precached.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['cesiumStatic/**', 'models/**', '**/*.map'],
      },
      manifest: {
        name: 'SkyView 3D — live flights in 3D',
        short_name: 'SkyView 3D',
        description: 'Live flights on a photorealistic 3D globe. Follow aircraft, watch takeoffs and landings, replay tracks and get alerts.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#060b14',
        theme_color: '#060b14',
        categories: ['travel', 'navigation', 'entertainment'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  preview: { port: 4173, host: true },
  build: {
    outDir: mode === 'mock' ? 'dist-mock' : 'dist',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 6000,
  },
}));

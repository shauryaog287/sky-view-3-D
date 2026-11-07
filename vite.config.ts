import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
// Cesium needs its Workers, Assets, ThirdParty and Widgets folders served as static files.
const cesiumBaseUrl = 'cesiumStatic';

export default defineConfig(({ mode }) => ({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
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

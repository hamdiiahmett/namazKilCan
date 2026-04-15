import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'CANCAN',
        short_name: 'CANCAN',
        description: 'Zenebimle uygulamamiz.',
        theme_color: '#fdf4ff',
        background_color: '#fdf4ff',
        display: 'standalone',
        icons: [
          {
            src: 'kalp.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
});

/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import type { CanvasGridEngine } from './grid-canvas/engine';

declare global {
  interface Window {
    __gridEngine?: CanvasGridEngine;
  }
}

export {};

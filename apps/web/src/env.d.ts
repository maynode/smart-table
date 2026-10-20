/// <reference types="vite/client" />

import type { CanvasGridEngine } from './grid-canvas/engine';

declare global {
  interface Window {
    __gridEngine?: CanvasGridEngine;
  }
}

export {};

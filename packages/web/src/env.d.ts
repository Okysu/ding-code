import type { Bootstrap } from '../../../shared/types';
declare global {
  interface Window {
    __DING_BOOT__?: Bootstrap;
    __VSCODE__?: { postMessage(message: unknown): void };
  }
}
export {};

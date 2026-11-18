/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Web build: base URL of the CORS proxy Worker (web/proxy), e.g. https://vigilante-proxy.example.workers.dev */
  readonly VITE_PROXY_URL?: string;
  /** Set by the web build (web/vite.config.ts). */
  readonly VITE_WEB?: string;
}

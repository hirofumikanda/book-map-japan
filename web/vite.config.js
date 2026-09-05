import { defineConfig } from "vite";

// このファイルが置かれている web/ をルートとし、public/ の img/*.png と
// book.pmtiles は加工せず dist/ 直下へコピーさせる(design.md Decision 11)。
// base を相対パスにすることで、オリジン直下でも GitHub Pages のサブパス
// (https://<user>.github.io/<repo>/)でも同じ成果物がそのまま動く。
// リポジトリ名をビルド設定へ埋め込まずに済む(spec: サブパス配信への対応)。
export default defineConfig({
  root: ".",
  publicDir: "public",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

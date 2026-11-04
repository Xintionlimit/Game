import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const embedded = {};
for (const folder of ['scenes', 'sprites']) {
  for (const name of await readdir(resolve(root, 'public/assets', folder))) {
    const mime = name.endsWith('.webp') ? 'image/webp' : 'image/png';
    const data = await readFile(resolve(root, 'public/assets', folder, name));
    embedded[`assets/${folder}/${name}`] = `data:${mime};base64,${data.toString('base64')}`;
  }
}

const output = await build({
  root,
  configFile: false,
  publicDir: false,
  plugins: [{
    name: 'embed-offline-art',
    transform(code, id) {
      if (!id.endsWith('/BootScene.ts')) return;
      return `const offlineAssets = ${JSON.stringify(embedded)};\n${code}`
        .replace('`assets/scenes/${scene}.webp`', 'offlineAssets[`assets/scenes/${scene}.webp`]')
        .replace('`assets/sprites/${sprite}.png`', 'offlineAssets[`assets/sprites/${sprite}.png`]');
    },
  }],
  build: {
    write: false,
    sourcemap: false,
    lib: { entry: resolve(root, 'src/main.ts'), name: 'MoriCourtyard', formats: ['iife'] },
  },
});
const bundles = Array.isArray(output) ? output : [output];
const files = bundles.flatMap((bundle) => bundle.output);
const js = files.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
const css = files.filter((file) => file.type === 'asset' && file.fileName.endsWith('.css')).map((file) => file.source).join('\n');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>末日小院·离线试玩</title><style>${css}</style></head><body><main id="game" aria-label="末日小院游戏画面"></main><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
await mkdir(resolve(root, 'dist-standalone'), { recursive: true });
await writeFile(resolve(root, 'dist-standalone/末日小院-直接打开玩.html'), html);
console.log('单文件试玩版已生成，图片和程序均已内置。');

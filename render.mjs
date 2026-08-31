// Pure Solid SSR — renderToStream only. No router, no solid-start, no ssr-query integration.
import { createServer } from 'vite';
const vite = await createServer({ configFile: './vite.config.mjs', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { renderToStream } = await vite.ssrLoadModule('@solidjs/web');
const { default: App } = await vite.ssrLoadModule('/src/App.tsx');

const chunks = [];
const dec = new TextDecoder();
let settled = false;
const timer = setTimeout(() => {
	if (!settled) {
		console.log(`  RESULT: HANG — stream did not finish in 8s (bytes so far: ${chunks.join('').length})`);
		process.exit(0);
	}
}, 8000);
try {
	const stream = renderToStream(() => App());
	await stream.pipeTo(new WritableStream({ write(c) { chunks.push(typeof c === 'string' ? c : dec.decode(c)); } }));
	settled = true;
	clearTimeout(timer);
	const html = chunks.join('');
	console.log(`  RESULT: COMPLETED — ${html.length} bytes; out=${(html.match(/id="out">[^<]*/) || ['(n/a)'])[0]}`);
} catch (e) {
	settled = true; clearTimeout(timer);
	console.log('  RESULT: THREW — ' + e);
}
await vite.close();
process.exit(0);

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');

async function build() {
        await esbuild.build({
                entryPoints: ['src/figma/code.ts'],
                bundle: true,
                format: 'iife',
                platform: 'browser',
                outfile: 'dist/figma/code.js',
                sourcemap: !production,
                minify: production,
                loader: {
                        '.html': 'text'
                },
        });

        const distDir = path.join(__dirname, 'dist', 'figma');
        fs.mkdirSync(distDir, { recursive: true });
        fs.copyFileSync(path.join(__dirname, 'src', 'figma', 'ui.html'), path.join(distDir, 'ui.html'));
        console.log('Figma plugin build complete.');
}

build().catch((error) => {
        console.error(error);
        process.exit(1);
});

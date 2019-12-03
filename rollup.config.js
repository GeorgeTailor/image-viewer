import svelte from 'rollup-plugin-svelte';
import resolve from 'rollup-plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import sass from 'node-sass';

const production = !process.env.ROLLUP_WATCH;

export default [
	{
		plugins: [
			svelte({
				preprocess: {
					style: ({ content, attributes }) => {
						if (attributes.type !== 'text/scss') return;
	
						return new Promise((fulfil, reject) => {
							sass.render({
								data: content,
								includePaths: ['src'],
								sourceMap: true,
								outFile: 'x' // this is necessary, but is ignored
							}, (err, result) => {
								if (err) return reject(err);
	
								fulfil({
									code: result.css.toString(),
									map: result.map.toString()
								});
							});
						});
					}
				},
				dev: !production
			}),
			resolve(),
			production && terser()
		],
		input: 'src/app.js',
		output: {
			sourcemap: false,
			format: 'iife',
			file: 'docs/app.js',
			name: 'app'
		}
	}
];

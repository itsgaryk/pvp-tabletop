import { sveltekit } from '@sveltejs/kit/vite';
import WindiCSS from 'vite-plugin-windicss'

const config = {
	plugins: [sveltekit(), WindiCSS()],
	server: {
		watch: {
			/*
			   The edit tooling writes files through `.<name>.tmpdir` folders in
			   place, which Vite's watcher tries to track and can crash on with
			   EBUSY. Keep those out of the watcher.
			*/
			ignored: ['**/.*.tmpdir/**', '**/.*.tmp']
		}
	}
};

export default config;

import path from 'path';
import Mocha from 'mocha';
import glob from 'glob';
import fs from 'fs';
import * as vscode from 'vscode';

declare global {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	var __coverage__: any;
}

export function writeCoverage() {
	if (typeof global.__coverage__ !== 'undefined') {
		const coverageDir = path.resolve(__dirname, '../../../.nyc_output');
		if (!fs.existsSync(coverageDir)) {
		fs.mkdirSync(coverageDir, { recursive: true });
		}
		const coverageFile = path.join(coverageDir, `out-${Date.now()}.json`);
		fs.writeFileSync(coverageFile, JSON.stringify(global.__coverage__));
		console.log(`Coverage written to ${coverageFile}`);
	} else {
		console.log('No coverage data collected.');
	}
}

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise((c, e) => {
		glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
			if (err) {
				return e(err);
			}

			// Add files to the test suite
			files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

			mocha.suite.beforeAll('activate extension', async function () {
				this.timeout(15000);
			
				const id = 'codescene.codescene-vscode';
				const ext = vscode.extensions.getExtension(id);
			
				console.log('Extension lookup:', id, '→', ext ? 'FOUND' : 'NOT FOUND');
			
				if (!ext) {
					throw new Error(`Extension ${id} was not found by VS Code`);
				}
			
				await ext.activate();
				console.log('Extension activated.');
			});

			mocha.suite.afterAll('write coverage', writeCoverage);

			try {
				// Run the mocha test
				mocha.run(failures => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						c();
					}
				});
			} catch (err) {
				console.error(err);
				e(err);
			}
		});
	});
}
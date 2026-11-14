import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const cwd = process.cwd();
const tscBin = path.resolve(cwd, '../../node_modules/typescript/bin/tsc');

execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.esm.json'], { cwd, stdio: 'inherit' });
execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.cjs.json'], { cwd, stdio: 'inherit' });

fs.mkdirSync(path.join(cwd, 'dist', 'esm'), { recursive: true });
fs.mkdirSync(path.join(cwd, 'dist', 'cjs'), { recursive: true });
fs.writeFileSync(path.join(cwd, 'dist', 'esm', 'package.json'), '{"type":"module"}\n');
fs.writeFileSync(path.join(cwd, 'dist', 'cjs', 'package.json'), '{"type":"commonjs"}\n');

/* eslint-disable @typescript-eslint/no-require-imports -- Jest transformers are loaded as CommonJS. */
// Jest runs the suite as CommonJS; shared ESM modules in scripts/ are transpiled to CommonJS here.
const ts = require('typescript');

module.exports = {
    process(source, filename) {
        const { outputText } = ts.transpileModule(source, {
            fileName: filename.replace(/\.mjs$/, '.js'),
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, allowJs: true },
        });
        return { code: outputText };
    },
};

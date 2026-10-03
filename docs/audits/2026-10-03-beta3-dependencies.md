# Beta.3 dependency security assessment

Assessment date: 3 October 2026. This records dependency exposure and remediation; final hosted publication checks are recorded in the release workflow.

## Production audit failure

The accepted tree reproduced five High findings with `npm audit --omit=dev`, including after an isolated clean `npm ci --omit=dev --ignore-scripts`. They all came from [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): nested brace patterns can exhaust recursive parser calls. The advisory and registry currently provide no patched `braces` release; 3.0.3 remains the published version.

The production path was:

```text
runtime tailwindcss-animate 1.0.7
  peer tailwindcss 3.4.19
    chokidar 3.6.0 / fast-glob 3.3.3 / micromatch 4.0.8
      braces 3.0.3
```

`tailwindcss` was declared in devDependencies but its animation plugin was in dependencies. npm therefore classified the peer compiler and its transitive packages as production dependencies. The Docker runtime copied the locked production tree and contained `braces`, `micromatch`, Tailwind and the animation plugin; the standalone trace itself did not contain them.

The plugin is used only by `tailwind.config.js` during CSS compilation. CompDesk's application/setup code does not import the listed glob/brace packages or accept request-supplied content paths or brace expressions. The compiler's source paths are fixed repository-owned patterns. The dependency was present in the runtime artifact even though no vulnerable application request path was found.

## Remediation

Moved `tailwindcss-animate` to devDependencies and regenerated lockfile classification. Dependency versions, Tailwind/PostCSS configuration, themes, responsive classes and animation generation remain unchanged. Production installs exclude the vulnerable chain; the Docker build still installs development tools in its build stage. Prisma and its migration tooling remain production dependencies.

No forced upgrade, incompatible override, advisory exception or weakened audit gate was used. A regression contract rejects production classification of the CSS compiler/plugin/brace-parser chain. Clean production installation and the unchanged `npm audit --omit=dev` gate verify the resulting tree; the final image is separately inspected and scanned before release promotion.

## Four historical GitHub alerts

Each advisory was reported twice, for package.json and package-lock.json on main.

| Alerts | Package / severity | Relationship / scope | Reachability | Fix |
| --- | --- | --- | --- | --- |
| 3, 4 — [GHSA-6vj9-mwq6-2f5v](https://github.com/advisories/GHSA-6vj9-mwq6-2f5v) | Nodemailer / Moderate | Direct / production | SMTP is a runtime feature; the vulnerable TLS server-name cache implementation is replaced in this release. | Patched in 10.0.2; locked 10.0.13. |
| 1, 2 — [GHSA-g57g-f23g-4646](https://github.com/advisories/GHSA-g57g-f23g-4646) | Nodemailer / Moderate | Direct / production | SMTP processes recipients at runtime; the vulnerable address parser is replaced in this release. | Patched in 10.0.9; locked 10.0.13. |

The fixes already existed in the acceptance branch; merging its patched manifests brings them to main. Alert closure must be verified against GitHub after its dependency graph refresh, rather than assumed or manually dismissed.

## Development audit remains nonzero

The complete audit reports 34 High package entries arising from the same unpatched brace-parser advisory, propagated through Tailwind 3, Jest 29 and the Next.js ESLint plugin. These are development dependencies after the classification fix, not 34 independent exploitable application defects. They process repository-owned source/file patterns during build/lint/test. Do not feed untrusted remote patterns to those tools or treat arbitrary build source as safe to execute.

A Tailwind 4 migration would remove one build dependency path, while Jest/ESLint paths also require separate tooling migrations or upstream fixes. It is not required to remediate the production artifact. The beta retains the existing styling/tool architecture and documents this known development exposure. Future compatible upstream fixes should be evaluated and locked promptly. This assessment is not an audit exception and does not claim zero vulnerabilities for the full development tree.

## Local verification

- Clean production install: zero audit findings and no `braces` dependency.
- Full development audit: 34 High propagated entries, as described above.
- Complete application verification: 76 Jest suites / 565 tests, lint, typecheck and production build passed.
- Runtime/release Node regressions: 71 passed. Prisma validation and the version-pinned Compose parse passed.
- Docker rebuilt from clean locked build/production stages. The actual runtime contains none of Tailwind, its animation plugin, `braces` or `micromatch`.
- Generated CSS is byte-identical to the accepted beta.2 runtime; themes, responsive utilities and animations were not recompiled through a different architecture.
- Beta.3 readiness, Entra configuration/diagnostic, actual image-cache writes, fresh uploads and private download rules passed. Attachment bytes and privacy survived restart; disposable probe records/files were removed. No unexpected runtime errors appeared.

Hosted pull-request/main checks and the tagged image's digest scan remain separate publication gates; local results do not replace them.

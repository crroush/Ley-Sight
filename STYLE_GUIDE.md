# TypeScript style and documentation

The project follows the substantive rules in the
[Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
while retaining the repository's established double-quote formatter output.

- ES modules are used throughout; new project APIs use named exports.
- `const` is the default and `let` is reserved for reassignment. `var`,
  TypeScript namespaces, and `require()` are not used in application source.
- Exported configuration, worker storage, and engine lifecycle APIs receive
  JSDoc that explains ownership, performance behavior, or non-obvious policy.
- Comments explain design constraints and “why”; they do not narrate obvious
  statements.
- Strict TypeScript is the first correctness gate. `npm run check` runs all
  tests and the production build.
- Runtime naming rules belong in `public/leysight.config.json`, not in
  TypeScript conditionals or test-dataset field lists.

Third-party APIs that require default imports (React/Vite/OpenLayers packages)
are the guide's external-code exception. Vite's configuration file also keeps
the default export required by that tool.

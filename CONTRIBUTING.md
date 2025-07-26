# 🤝 Contributing to `@dekzer/wav-decoder`

Thank you for your interest in improving `@dekzer/wav-decoder`! This project welcomes contributions — whether you’re fixing bugs, improving documentation, writing tests, or proposing new features.

---

## 🧠 What This Project Is

**`@dekzer/wav-decoder`** is a streaming‑capable WAV audio decoder written in TypeScript:

- Zero dependencies
- Works in Node.js, browsers, and AudioWorklets
- Supports PCM (8/16/24/32‑bit), IEEE float, A‑law, μ‑law
- Fully endianness‑aware

---

## 🚀 Getting Started

1. **Clone the repository**

   ```bash
   git clone https://github.com/dekzer-oss/wav-decoder.git
   cd wav-decoder
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Run tests**

   ```bash
   pnpm test:ci
   ```

4. **Run demo**

   ```bash
   pnpm demo
   ```

---

## 🛠️ Development Guidelines

- **Keep code modular & minimal.** Avoid adding runtime dependencies.
- **Type everything.** Leverage our strict TS settings.
- **Write or update tests** for any new behavior (using Vitest):
  - Node: `pnpm test:node`
  - Browser: `pnpm test:browser`
  - All: `pnpm test:all`
  - Watch mode: `pnpm dev`

- **Format code** with Prettier before commit:

  ```bash
  pnpm format
  ```

---

## 📦 CI & Workflows

We use GitHub Actions to automate testing, benchmarking, and releases across three workflows:

1. **CI** (`.github/workflows/ci.yml`): Runs on every push or PR to `main`, installs dependencies, runs `pnpm test:ci`, and builds the package.

2. **Benchmarks** (`.github/workflows/bench.yml`): On PRs touching `src/**` or `tests/**`, and on pushes to `main`, it runs `pnpm bench:compare`. When on `main`, it also updates our browser & Node throughput badges (`.json` endpoints) and pushes the results.

3. **Release** (`.github/workflows/release.yml`): Triggered on every push to `main`:
   - If `NPM_TOKEN` is set, the workflow uses the [Changesets Action](https://github.com/changesets/action) to:
     1. **Detect** any `.changeset/*.md` files you’ve committed
     2. **Run** `changeset version` to bump versions and update `CHANGELOG.md`
     3. **Commit** the version bump back to `main`
     4. **Publish** to npm (`pnpm release`), using the `beta` tag in prerelease mode or `latest` otherwise

   - If `NPM_TOKEN` is missing, it skips publishing.

---

## 📦 Releasing (for Maintainers)

We rely on [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs automatically:

1. **Create a new Changeset** locally:

   ```bash
   pnpm changeset
   ```

   - Select the package (only one), choose `patch`/`minor`/`major`, and write a summary.

2. _(For prereleases)_ Enter beta mode (optional):

   ```bash
   pnpm changeset pre enter beta
   ```

3. **Commit** both your code changes and the generated `.changeset/*.md` file:

   ```bash
   git add <your files> .changeset/*.md
   git commit -m "feat: describe your change"
   ```

4. **Push** to `main`:

   ```bash
   git push
   ```

   The **Release** workflow will then bump the version, update the changelog, and publish to npm under the correct dist‑tag.

5. _(To exit prerelease)_

   ```bash
   pnpm changeset pre exit
   ```

---

## 📬 Questions or Suggestions

Feel free to open an [Issue](https://github.com/dekzer-oss/wav-decoder/issues) or start a [Discussion](https://github.com/dekzer-oss/wav-decoder/discussions). Contributions, feedback, and ideas are always welcome!

---

## 🙏 Thank You

This project thrives on community support — whether it’s code, testing, or ideas, your contributions matter! ❤️

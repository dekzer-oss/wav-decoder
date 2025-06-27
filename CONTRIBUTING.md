# 🤝 Contributing to streaming-wav-decoder

Thanks for your interest in improving `streaming-wav-decoder`!  
This project welcomes contributions — whether you're fixing bugs, improving documentation, writing tests, or proposing
features.

## 🧠 What this project is

A streaming-capable WAV audio decoder written in TypeScript.  
Zero dependencies. Works in Node.js, browsers, and AudioWorklets.  
Supports PCM, IEEE float, A-law, µ-law — fully endianness-aware.

---

## 🚀 Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/dekzer-oss/streaming-wav-decoder.git
   cd streaming-wav-decoder
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Run tests**
   ```bash
   pnpm test
   ```

4. **Start demo**
   ```bash
   pnpm demo
   ```
---

## ✅ Contributing Guidelines

### ✨ Features & Fixes

* Keep code modular and minimal.
* Avoid adding runtime dependencies.
* Write clear, typed, readable TypeScript.

### 🧪 Tests

* All changes should include relevant tests (`vitest` is used).
* Use `test:node`, `test:dom`, and `test:browser` as needed.

### 🎨 Formatting

* Run Prettier before committing:

  ```bash
  pnpm format
  ```

---

## 📦 Releasing (for maintainers)

1. Use [Changesets](https://github.com/changesets/changesets):

   ```bash
   pnpm changeset
   ```

2. When ready to publish:

   ```bash
   pnpm release
   ```

---

## 📬 Questions or Suggestions?

Feel free to open:

* An [Issue](https://github.com/dekzer-oss/streaming-wav-decoder/issues)
* A [Discussion](https://github.com/dekzer-oss/streaming-wav-decoder/discussions)
* Or reach out directly.

---

## 🙏 Thanks

This project thrives on community support.
Whether it’s code, testing, or ideas — your contribution matters. ❤️

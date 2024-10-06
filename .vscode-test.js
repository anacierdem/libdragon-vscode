const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig([
  {
    files: "out/**/*.test.js",
    mocha: {
      ui: "bdd",
      timeout: 60000,
    },
  },
]);

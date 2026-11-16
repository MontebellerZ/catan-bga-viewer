const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".\\tests",
  testMatch: "**/*.spec.js",
  workers: 1,
  reporter: "list"
});

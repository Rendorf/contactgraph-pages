export default [{
  files: ["scripts/**/*.mjs"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: {
      AbortSignal: "readonly",
      Buffer: "readonly",
      URL: "readonly",
      clearTimeout: "readonly",
      console: "readonly",
      fetch: "readonly",
      process: "readonly",
      setInterval: "readonly",
      setTimeout: "readonly",
    },
  },
  rules: {
    "no-constant-binary-expression": "error",
    "no-dupe-else-if": "error",
    "no-duplicate-imports": "error",
    "no-self-assign": "error",
    "no-undef": "error",
    "no-unreachable": "error",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "valid-typeof": "error",
  },
}];

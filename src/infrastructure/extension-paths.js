const os = require("os");
const path = require("path");

function codexHome() {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

function extensionsRoot() {
  return path.join(codexHome(), "extensions");
}

module.exports = {
  codexHome,
  extensionsRoot,
};

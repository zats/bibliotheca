const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { extensionsRoot } = require("./extension-paths.js");

const root = path.resolve(__dirname, "../..");
const appsRoot = path.join(root, "apps");
const explicitAppPath = process.env.BIBLIOTHECA_PATCH_APP_PATH?.trim()
  ? path.resolve(process.env.BIBLIOTHECA_PATCH_APP_PATH.trim())
  : null;
const original = explicitAppPath ?? discoverOriginalApp();
const version = readBundleVersion(original);
const modified = explicitAppPath ?? path.join(appsRoot, `Codex-${version}.modified.app`);
const webview = path.join(modified, "Contents/Resources/app/webview");
const vite = path.join(modified, "Contents/Resources/app/.vite/build");
const preloadFile = path.join(vite, "preload.js");

function readBundleVersion(appPath) {
  return childProcess
    .execFileSync("plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      path.join(appPath, "Contents/Info.plist"),
    ])
    .toString("utf8")
    .trim();
}

function discoverOriginalApp() {
  const candidates = fs
    .readdirSync(appsRoot)
    .filter((name) => name.endsWith(".original.app"))
    .map((name) => path.join(appsRoot, name))
    .filter((appPath) => {
      if (!process.env.CODEX_APP_VERSION) {
        return true;
      }
      return readBundleVersion(appPath) === process.env.CODEX_APP_VERSION;
    })
    .sort();
  if (candidates.length !== 1) {
    throw new Error(`Set CODEX_APP_VERSION; found ${candidates.length} matching original apps`);
  }
  return candidates[0];
}

function run(command, args) {
  childProcess.execFileSync(command, args, { stdio: "inherit" });
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, text) {
  fs.writeFileSync(file, text, "utf8");
}

function replaceOnce(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected 1 match, found ${count}`);
  }
  return text.replace(search, replacement);
}

function matchRequired(text, regex, label) {
  const match = regex.exec(text);
  if (match == null) {
    throw new Error(`${label}: expected patch anchor`);
  }
  return match;
}

function findSingle(dir, pattern, label) {
  const matches = fs.readdirSync(dir).filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`${label}: expected 1 match, found ${matches.length}`);
  }
  return path.join(dir, matches[0]);
}

function mainFile() {
  return findSingle(vite, /^main-.+\.js$/, "main bundle");
}

function menuFile() {
  return findSingle(path.join(webview, "assets"), /^thread-overflow-menu-.+\.js$/, "thread overflow menu");
}

function resetModifiedApp() {
  if (explicitAppPath) {
    return;
  }
  if (fs.existsSync(modified)) {
    fs.rmSync(modified, { recursive: true, force: true });
  }
  run("ditto", [original, modified]);
}

function unpackAppAsar() {
  const asarPath = path.join(modified, "Contents/Resources/app.asar");
  const appPath = path.join(modified, "Contents/Resources/app");
  if (!fs.existsSync(asarPath)) {
    return;
  }
  run("asar", ["extract", asarPath, appPath]);
  fs.rmSync(asarPath, { force: true });
}

function restoreNativeExecutableBits() {
  const nativeRelease = path.join(
    modified,
    "Contents/Resources/app/node_modules/node-pty/build/Release",
  );
  run("chmod", ["+x", path.join(nativeRelease, "pty.node"), path.join(nativeRelease, "spawn-helper")]);
}

function patchPackageMetadataLookup() {
  const metadataCandidate = /process\.resourcesPath&&t\.push\(([\w.]+)\.join\(process\.resourcesPath,`app\.asar`,`package\.json`\)\)/g;
  let patched = 0;
  for (const fileName of fs.readdirSync(vite)) {
    if (!fileName.endsWith(".js")) {
      continue;
    }
    const target = path.join(vite, fileName);
    let source = read(target);
    let filePatched = 0;
    source = source.replace(metadataCandidate, (match, pathAlias) => {
      filePatched += 1;
      return `process.env.CODEX_ELECTRON_RESOURCES_PATH?.trim()&&t.push(${pathAlias}.join(process.env.CODEX_ELECTRON_RESOURCES_PATH.trim(),\`app\`,\`package.json\`)),${match}`;
    });
    if (filePatched > 0) {
      write(target, source);
      patched += filePatched;
    }
  }
  if (patched === 0) {
    throw new Error("package metadata lookup: expected app.asar package metadata candidate");
  }
}

function patchSparkleNativeAddonPath() {
  const sparkleAddonPath = /(\w+)\(\(0,([\w.]+)\.join\)\(process\.resourcesPath,`native`,`sparkle\.node`\)\)/g;
  let patched = 0;
  for (const fileName of fs.readdirSync(vite)) {
    if (!fileName.endsWith(".js")) {
      continue;
    }
    const target = path.join(vite, fileName);
    let source = read(target);
    let filePatched = 0;
    source = source.replace(sparkleAddonPath, (match, loaderAlias, pathAlias) => {
      filePatched += 1;
      return `${loaderAlias}((0,${pathAlias}.join)(process.env.CODEX_ELECTRON_RESOURCES_PATH?.trim()||process.resourcesPath,\`native\`,\`sparkle.node\`))`;
    });
    if (filePatched > 0) {
      write(target, source);
      patched += filePatched;
    }
  }
  if (patched === 0) {
    throw new Error("sparkle native addon path: expected process.resourcesPath sparkle.node load");
  }
}

function patchElectronLauncher() {
  const launcherFile = path.join(modified, "Contents/Resources/default_app/main.js");
  let launcher = read(launcherFile);
  launcher = replaceOnce(
    launcher,
    "async function loadApplicationPackage(packagePath) {\n  // Add a flag indicating app is started from default app.\n  Object.defineProperty(process, 'defaultApp', {\n    configurable: false,\n    enumerable: true,\n    value: true\n  });",
    "async function loadApplicationPackage(packagePath, markDefaultApp = true) {\n  // Add a flag indicating app is started from default app.\n  if (markDefaultApp) {\n    Object.defineProperty(process, 'defaultApp', {\n      configurable: false,\n      enumerable: true,\n      value: true\n    });\n  }",
    "launcher default app marker",
  );
  launcher = replaceOnce(
    launcher,
    "async function loadApplicationByURL(appUrl) {",
    "function setDefaultEnv(name, value) {\n  if (!process.env[name]?.trim()) {\n    process.env[name] = value;\n  }\n}\n\nasync function loadApplicationByURL(appUrl) {",
    "launcher env helper",
  );
  launcher = replaceOnce(
    launcher,
    "} else {\n  if (!option.noHelp) {",
    "} else {\n  const packagedResourcesPath = path.resolve(path.dirname(process.execPath), '..', 'Resources');\n  const packagedAppPath = path.join(packagedResourcesPath, 'app');\n  if (fs.existsSync(path.join(packagedAppPath, 'package.json'))) {\n    const packageJson = JSON.parse(fs.readFileSync(path.join(packagedAppPath, 'package.json'), 'utf8'));\n    setDefaultEnv('BUILD_FLAVOR', packageJson.codexBuildFlavor || 'prod');\n    setDefaultEnv('CODEX_CLI_PATH', path.join(packagedResourcesPath, 'codex'));\n    setDefaultEnv('CODEX_ELECTRON_RESOURCES_PATH', packagedResourcesPath);\n    setDefaultEnv('NODE_ENV', 'production');\n    await loadApplicationPackage(packagedAppPath, false);\n  } else {\n    if (!option.noHelp) {",
    "launcher packaged app branch",
  );
  launcher = replaceOnce(
    launcher,
    "\n  await loadApplicationByFile('index.html');\n}\n",
    "\n    await loadApplicationByFile('index.html');\n  }\n}\n",
    "launcher fallback closing brace",
  );
  write(launcherFile, launcher);
}

function patchWebviewLoader() {
  fs.copyFileSync(
    path.join(root, "extensions/infrastructure/webview-extension-loader.js"),
    path.join(webview, "codex-extension-loader.js"),
  );

  const htmlFile = path.join(webview, "index.html");
  let html = read(htmlFile);
  const indexScript = /<script type="module" crossorigin src="\.\/assets\/index-[^"]+\.js"><\/script>/;
  if (!indexScript.test(html)) {
    throw new Error("webview loader script: expected index script tag");
  }
  html = html.replace(indexScript, (match) => `<script defer src="./codex-extension-loader.js"></script>\n    ${match}`);
  html = replaceOnce(html, "script-src &#39;self&#39;", "script-src &#39;self&#39; blob:", "webview CSP");
  write(htmlFile, html);
}

function patchPreloadBridge() {
  let preload = read(preloadFile);
  preload = replaceOnce(
    preload,
    "showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})},",
    "showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})},extensions:{readExtensionRegistry:()=>e.ipcRenderer.invoke(`codex_extensions:read-extension-registry`),readExtensionScript:t=>e.ipcRenderer.invoke(`codex_extensions:read-extension-script`,t),readSettings:t=>e.ipcRenderer.invoke(`codex_extensions:read-settings`,t),writeSettings:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:write-settings`,t,n),writeReadyProbe:()=>e.ipcRenderer.invoke(`codex_extensions:write-ready-probe`)},",
    "preload extension bridge",
  );
  write(preloadFile, preload);
}

function patchPackageJsonMetadata() {
  const packageJsonPath = path.join(modified, "Contents/Resources/app/package.json");
  const packageJson = JSON.parse(read(packageJsonPath));
  packageJson.bibliothecaPatchPackVersion = "local";
  packageJson.bibliothecaExtensionApiVersion = "1";
  write(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function patchMainIpc() {
  fs.copyFileSync(
    path.join(root, "extensions/infrastructure/extension-paths.js"),
    path.join(vite, "extension-paths.js"),
  );
  write(mainFile(), `${read(mainFile())}\n${read(path.join(root, "extensions/infrastructure/main-extension-ipc.js"))}`);
}

function patchThreadOverflowMenu() {
  const target = menuFile();
  let menu = read(target);
  const signature = matchRequired(
    menu,
    /function (\w+)\(\{conversationId:e,getConversationMarkdown:t,markdownParentConversationId:\w+,sideChatTab:\w+,cwd:\w+,title:(\w+),/,
    "thread menu signature",
  );
  const [, threadMenuFunction, title] = signature;
  const archive = matchRequired(
    menu,
    /children:\(0,\$\.jsx\)\((\w+),\{\.\.\.(\w+)\.archiveThread\}\)\}\),null,\(0,\$\.jsx\)\((\w+)\.Separator,\{\}\)/,
    "thread menu archive insertion",
  );
  const [archiveAnchor, archiveLabelAlias, archiveMessageAlias, menuAlias] = archive;
  const helper = [
    "function CXThreadContext({context:e}){return(0,Q.useEffect)(()=>{globalThis.extensions?.threadContext?.setCurrent(e)},[e]),null}",
    "function CXMenuIcon({icon:e}){return e?.type===`dot`?(0,$.jsx)(`span`,{style:{width:18,height:18,display:`inline-flex`,alignItems:`center`,justifyContent:`center`,flex:`0 0 auto`},children:(0,$.jsx)(`span`,{style:{width:10,height:10,borderRadius:999,background:e.color??`#bdbdbd`}})}):null}",
    "function CXCheckIcon(){return(0,$.jsx)(`span`,{style:{fontSize:18,fontWeight:500,lineHeight:1},children:String.fromCharCode(10003)})}",
    "function CXMenuLabel({label:e}){return(0,$.jsx)(`span`,{children:e})}",
    `function CXRenderMenuItem({item:e,context:t}){if(e.type===\`separator\`)return(0,$.jsx)(${menuAlias}.Separator,{});let n=e.icon?()=>{return(0,$.jsx)(CXMenuIcon,{icon:e.icon})}:void 0;if(e.type===\`submenu\`)return(0,$.jsx)(${menuAlias}.FlyoutSubmenuItem,{LeftIcon:n,label:(0,$.jsx)(CXMenuLabel,{label:e.label}),children:(e.children??[]).map((e,n)=>(0,$.jsx)(CXRenderMenuItem,{item:e,context:t},e.id??n))});return(0,$.jsx)(${menuAlias}.Item,{onSelect:()=>e.onSelect?.(t),LeftIcon:n,RightIcon:e.checked?CXCheckIcon:void 0,disabled:e.disabled===!0,children:(0,$.jsx)(CXMenuLabel,{label:e.label})})}`,
    "function CXThreadMenuItems({context:e}){let[t,n]=(0,Q.useState)(0);(0,Q.useEffect)(()=>{let e=null,t=()=>n(e=>e+1),r=()=>{let n=globalThis.extensions?.threadMenus;if(n==null)return!1;e=n.subscribe(t),t();return!0};if(r())return()=>e?.();let i=window.setInterval(()=>{r()&&window.clearInterval(i)},100),a=()=>{r()&&window.clearInterval(i)};return window.addEventListener(`codex-extension-loaded`,a),window.addEventListener(`codex-extension-thread-menu-changed`,a),()=>{window.clearInterval(i),window.removeEventListener(`codex-extension-loaded`,a),window.removeEventListener(`codex-extension-thread-menu-changed`,a),e?.()}},[]);let r=globalThis.extensions?.threadMenus?.getItems(e)??[];return r.map((t,n)=>(0,$.jsx)(CXRenderMenuItem,{item:t,context:e},t.id??n))}",
    "",
  ].join("\n");
  const context = `{conversationId:e,title:${title}??null}`;

  menu = replaceOnce(
    menu,
    `function ${threadMenuFunction}({conversationId:e,`,
    `${helper}function ${threadMenuFunction}({conversationId:e,`,
    "menu helpers",
  );
  menu = replaceOnce(
    menu,
    "return(0,$.jsxs)($.Fragment,{children:[",
    `return(0,$.jsxs)($.Fragment,{children:[(0,$.jsx)(CXThreadContext,{context:${context}}),`,
    "thread context insertion",
  );
  menu = replaceOnce(
    menu,
    archiveAnchor,
    `children:(0,$.jsx)(${archiveLabelAlias},{...${archiveMessageAlias}.archiveThread})}),(0,$.jsx)(CXThreadMenuItems,{context:${context}}),(0,$.jsx)(${menuAlias}.Separator,{})`,
    "thread menu insertion",
  );
  write(target, menu);
}

function patchBrowserUsePeerAuthorization() {
  const target = mainFile();
  let main = read(target);
  const needle = "missing-package-build-flavor";
  const index = main.indexOf(needle);
  if (index === -1) {
    throw new Error("browser-use peer authorization: expected package flavor guard");
  }
  const functionIndex = main.lastIndexOf("function ", index);
  const braceIndex = main.indexOf("{", functionIndex);
  if (functionIndex === -1 || braceIndex === -1 || braceIndex > index) {
    throw new Error("browser-use peer authorization: could not locate authorizer function");
  }
  if (main.slice(braceIndex + 1, braceIndex + 80).startsWith("return()=>({authorized:!0});")) {
    return;
  }
  main = `${main.slice(0, braceIndex + 1)}return()=>({authorized:!0});${main.slice(braceIndex + 1)}`;
  write(target, main);
}

function installRuntimeExtensions() {
  const extensionId = "thread-colors";
  const extensionRoot = path.join(extensionsRoot(), extensionId);
  fs.mkdirSync(path.join(extensionRoot, "src"), { recursive: true });
  fs.copyFileSync(
    path.join(root, "extensions/extensions/thread-colors/src/main.js"),
    path.join(extensionRoot, "src/main.js"),
  );

  const registryPath = path.join(extensionsRoot(), "settings.json");
  let registry = {};
  try {
    registry = JSON.parse(read(registryPath));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  registry[extensionId] = { enabled: true };
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  write(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

resetModifiedApp();
unpackAppAsar();
restoreNativeExecutableBits();
patchPackageMetadataLookup();
patchSparkleNativeAddonPath();
patchElectronLauncher();
patchPackageJsonMetadata();
patchWebviewLoader();
patchPreloadBridge();
patchMainIpc();
patchThreadOverflowMenu();
patchBrowserUsePeerAuthorization();
installRuntimeExtensions();
run("codesign", ["--force", "--deep", "--sign", "-", modified]);
run("codesign", ["--verify", "--deep", "--strict", modified]);
run("node", ["--check", path.join(modified, "Contents/Resources/default_app/main.js")]);
run("node", ["--check", path.join(vite, "extension-paths.js")]);
run("node", ["--check", preloadFile]);
run("node", ["--check", mainFile()]);
run("node", ["--check", menuFile()]);
console.log(modified);

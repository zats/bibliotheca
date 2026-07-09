const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { extensionsRoot } = require("../runtime/extension-paths.js");

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

function profileMenuFile() {
  return findSingle(
    path.join(webview, "assets"),
    /^app-initial~app-main~automations-page-.+\.js$/,
    "profile menu bundle",
  );
}

function loginRouteFile() {
  return findSingle(path.join(webview, "assets"), /^login-route-.+\.js$/, "login route bundle");
}

function appServerFile() {
  const matches = fs
    .readdirSync(vite)
    .filter((name) => /^src-.+\.js$/.test(name))
    .map((name) => path.join(vite, name))
    .filter((file) => read(file).includes("NR=class{readyState=cL.Connecting;"));
  if (matches.length !== 1) {
    throw new Error(`app server bundle: expected 1 transport match, found ${matches.length}`);
  }
  return matches[0];
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
    path.join(root, "extensions/runtime/webview-extension-loader.js"),
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
    "showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})},extensions:{readExtensionRegistry:()=>e.ipcRenderer.invoke(`codex_extensions:read-extension-registry`),readExtensionScript:t=>e.ipcRenderer.invoke(`codex_extensions:read-extension-script`,t),readSettings:t=>e.ipcRenderer.invoke(`codex_extensions:read-settings`,t),writeSettings:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:write-settings`,t,n),readData:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:read-data`,t,n),listData:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:list-data`,t,n),writeData:(t,n,r)=>e.ipcRenderer.invoke(`codex_extensions:write-data`,t,n,r),deleteData:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:delete-data`,t,n),readCodexAuth:()=>e.ipcRenderer.invoke(`codex_extensions:read-codex-auth`),writeCodexAuth:t=>e.ipcRenderer.invoke(`codex_extensions:write-codex-auth`,t),removeCodexAuth:()=>e.ipcRenderer.invoke(`codex_extensions:remove-codex-auth`),reloadWindow:()=>e.ipcRenderer.invoke(`codex_extensions:reload-window`),writeReadyProbe:()=>e.ipcRenderer.invoke(`codex_extensions:write-ready-probe`)},",
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
    path.join(root, "extensions/runtime/extension-paths.js"),
    path.join(vite, "extension-paths.js"),
  );
  const target = mainFile();
  let main = read(target);
  main = replaceOnce(
    main,
    "case`codex-app-server-restart`:{let e=this.getAppServerConnection(n.hostId);await e.restart({killCodexProcess:n.killCodexProcess??!1}),n.remoteControlEnabled&&await e.sendAppServerRequest(`remoteControl/enable`,null),SQ().info(`Codex app-server restart requested`);break}",
    "case`codex-app-server-restart`:{let e=this.getAppServerConnection(n.hostId);await e.restart({killCodexProcess:n.killCodexProcess??!1}),n.remoteControlEnabled&&await e.sendAppServerRequest(`remoteControl/enable`,null),SQ().info(`Codex app-server restart requested`);break}case`codex-app-server-refresh-auth-token`:{let t=n.requestId,r=async()=>{let e=this.getAppServerConnection(n.hostId);e.clearAuthTokenCache(),await e.getAuthToken({refreshToken:n.refreshToken??!0}),SQ().info(`Codex app-server auth token refresh requested`)};if(t!=null)try{await r(),this.windowManager.sendMessageToWebContents(e,{type:`codex-app-server-refresh-auth-token-response`,requestId:t,ok:!0})}catch(n){this.windowManager.sendMessageToWebContents(e,{type:`codex-app-server-refresh-auth-token-response`,requestId:t,ok:!1,errorMessage:n instanceof Error?n.message:String(n)})}else await r();break}",
    "app-server auth token refresh message",
  );
  write(target, `${main}\n${read(path.join(root, "extensions/runtime/main-extension-ipc.js"))}`);
}

function patchAppServerTransportKill() {
  const target = appServerFile();
  let source = read(target);
  source = replaceOnce(
    source,
    "NR=class{readyState=cL.Connecting;",
    "CXExecFile=function(e,t){return new Promise((n,r)=>{(0,d.execFile)(e,t,{encoding:`utf8`},(e,t)=>{e&&e.code!==1?r(e):n(t??``)})})},CXChildProcessIds=async function(e){let t=await CXExecFile(`pgrep`,[`-P`,String(e)]);return t.split(/\\s+/).map(Number).filter(Number.isInteger)},CXProcessTreeIds=async function(e){let t=[],n=[e];for(;n.length>0;){let e=n.pop();if(e==null||t.includes(e))continue;t.push(e);let r=await CXChildProcessIds(e);for(let e of r)n.push(e)}return t},CXKillProcessTree=async function(e){let t=await CXProcessTreeIds(e);for(let e of t.slice(1).reverse())try{process.kill(e,`SIGKILL`)}catch{}try{process.kill(e,`SIGKILL`)}catch{}for(let n=0;n<50;n++){let n=t.filter(e=>{try{return process.kill(e,0),!0}catch{return!1}});if(n.length===0)return;await new Promise(e=>setTimeout(e,50))}},NR=class{readyState=cL.Connecting;",
    "app-server process tree kill helpers",
  );
  source = replaceOnce(
    source,
    "close(){if(this.readyState===cL.Closed)return;if(this.readyState=cL.Closing,this.resetStdoutDispatchState(),!this.proc){this.readyState=cL.Closed,this.emitClose({type:`close`,code:null,reason:null,signal:null});return}if(!this.proc.killed&&this.proc.exitCode==null){this.proc.kill();return}let e=this.proc.exitCode;this.cleanupProcessListeners(),this.proc=null,this.readyState=cL.Closed,this.emitClose({type:`close`,code:e,reason:null,signal:null})}",
    "close(){if(this.readyState===cL.Closed)return;if(this.readyState=cL.Closing,this.resetStdoutDispatchState(),!this.proc){this.readyState=cL.Closed,this.emitClose({type:`close`,code:null,reason:null,signal:null});return}if(!this.proc.killed&&this.proc.exitCode==null){this.proc.kill();return}let e=this.proc.exitCode;this.cleanupProcessListeners(),this.proc=null,this.readyState=cL.Closed,this.emitClose({type:`close`,code:e,reason:null,signal:null})}async killCodexProcess(){let e=this.proc?.pid;if(e==null)return;await CXKillProcessTree(e)}",
    "stdio connection hard kill method",
  );
  source = replaceOnce(
    source,
    "PR=class{kind=`stdio`;ioStatsTracker=new yR;constructor(e){this.options=e}supportsReconnect(){return!1}async connect(){let e=FR(this.options);if(!e)throw Error(`Unable to locate the Codex CLI binary. Set CODEX_CLI_PATH or ensure the Electron resources include bin/codex.`);return new NR(e,this.ioStatsTracker)}getIoStatsSnapshot(){return this.ioStatsTracker.getSnapshot()}};",
    "PR=class{kind=`stdio`;ioStatsTracker=new yR;activeConnection=null;constructor(e){this.options=e}supportsReconnect(){return!1}async connect(){let e=FR(this.options);if(!e)throw Error(`Unable to locate the Codex CLI binary. Set CODEX_CLI_PATH or ensure the Electron resources include bin/codex.`);return this.activeConnection=new NR(e,this.ioStatsTracker)}async killCodexProcess(){await this.activeConnection?.killCodexProcess?.()}getIoStatsSnapshot(){return this.ioStatsTracker.getSnapshot()}};",
    "stdio transport hard kill hook",
  );
  source = replaceOnce(
    source,
    "async restart({killCodexProcess:e=!1}={}){if(this.logger.info(`Restart requested`,{safe:{killCodexProcess:e,transportKind:this.options.transport.kind,hostId:this.options.hostId},sensitive:{}}),this.stopProcess(),this.restartInFlight=!0,this.setConnectionState(`restarting`,`restart_requested`),e)try{await this.options.transport.killCodexProcess?.()}catch(e){this.logger.error(`Error while killing codex process`,{safe:{transportKind:this.options.transport.kind,hostId:this.options.hostId},sensitive:{error:e}})}this.logger.info(`Ensuring ready`,{safe:{initialized:this.initialized,nonRetryableFatalError:this.nonRetryableFatalError!=null,reconnectTimer:this.reconnectTimer!=null,initializingPromise:this.initializingPromise!=null,hostId:this.options.hostId},sensitive:{}})",
    "async restart({killCodexProcess:e=!1}={}){if(this.logger.info(`Restart requested`,{safe:{killCodexProcess:e,transportKind:this.options.transport.kind,hostId:this.options.hostId},sensitive:{}}),e)try{await this.options.transport.killCodexProcess?.()}catch(e){this.logger.error(`Error while killing codex process`,{safe:{transportKind:this.options.transport.kind,hostId:this.options.hostId},sensitive:{error:e}})}this.stopProcess(),this.restartInFlight=!0,this.setConnectionState(`restarting`,`restart_requested`),this.logger.info(`Ensuring ready`,{safe:{initialized:this.initialized,nonRetryableFatalError:this.nonRetryableFatalError!=null,reconnectTimer:this.reconnectTimer!=null,initializingPromise:this.initializingPromise!=null,hostId:this.options.hostId},sensitive:{}})",
    "app-server restart hard kill ordering",
  );
  write(target, source);
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

function patchProfileMenu() {
  const target = profileMenuFile();
  let menu = read(target);
  const helper = [
    "function CXProfileMenuIcon({icon:e}){if(e?.type===`dot`)return(0,PR.jsx)(`span`,{style:{width:20,height:20,display:`inline-flex`,alignItems:`center`,justifyContent:`center`,flex:`0 0 auto`},children:(0,PR.jsx)(`span`,{style:{width:10,height:10,borderRadius:999,background:e.color??`#bdbdbd`}})});if(e?.type===`svg`)return(0,PR.jsx)(`svg`,{xmlns:`http://www.w3.org/2000/svg`,width:16,height:16,viewBox:e.viewBox??`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:e.strokeWidth??1,strokeLinecap:`round`,strokeLinejoin:`round`,className:e.className,style:{flex:`0 0 auto`},children:(e.paths??[]).map((e,t)=>(0,PR.jsx)(`path`,{d:e},t))});return null}",
    "function CXProfileMenuLabel({label:e,nested:t}){return(0,PR.jsx)(`span`,{className:t?`pl-6`:void 0,children:e})}",
    "function CXProfileMenuContent({label:e,expanded:t}){return(0,PR.jsxs)(`span`,{className:`flex w-full min-w-0 items-center justify-between gap-2`,children:[(0,PR.jsx)(CXProfileMenuLabel,{label:e}),(0,PR.jsx)(`span`,{className:`shrink-0 text-token-text-tertiary`,style:{fontSize:18,lineHeight:1,transform:t?`rotate(90deg)`:void 0},children:String.fromCharCode(8250)})]})}",
    "function CXProfileMenuLeftIcon(e){return e?.icon?()=>{return(0,PR.jsx)(CXProfileMenuIcon,{icon:e.icon})}:void 0}",
    "function CXWaitForAppServerInitialized(e){console.log(`[codex-ext/profile-auth] wait codex-app-server-initialized`,e);return new Promise(t=>{let n=r=>{let i=r.data;i?.type===`codex-app-server-initialized`&&console.log(`[codex-ext/profile-auth] saw codex-app-server-initialized`,i.hostId);i?.type===`codex-app-server-initialized`&&i.hostId===e&&(console.log(`[codex-ext/profile-auth] matched codex-app-server-initialized`,e),window.removeEventListener(`message`,n),t())};window.addEventListener(`message`,n)})}",
    "function CXDispatchMainRequest(e,t,n){let r=crypto.randomUUID();return new Promise((i,a)=>{let o=s=>{let c=s.data;c?.type===n&&c.requestId===r&&(window.removeEventListener(`message`,o),c.ok?i(c.result):a(c.errorMessage?new Error(c.errorMessage):new Error(`${e} failed`)))};window.addEventListener(`message`,o);try{z.dispatchMessage(e,{...t,requestId:r})}catch(e){window.removeEventListener(`message`,o),a(e)}})}",
    "function CXRefreshProfileAuthState(e,t){return async n=>{console.log(`[codex-ext/profile-auth] refresh start`,{hostId:t,authMode:n});e(null);console.log(`[codex-ext/profile-auth] notify account/updated null`);await Ts(`handle-app-server-notification-for-host`,{hostId:t,notification:{method:`account/updated`,params:{authMode:null}}});let r=CXWaitForAppServerInitialized(t);console.log(`[codex-ext/profile-auth] dispatch app-server restart`);z.dispatchMessage(`codex-app-server-restart`,{hostId:t,killCodexProcess:!0,errorMessage:null});console.log(`[codex-ext/profile-auth] await initialized`);await r;console.log(`[codex-ext/profile-auth] initialized wait resolved`);n!==void 0&&(console.log(`[codex-ext/profile-auth] refresh tokens start`),await CXRefreshProfileAuthTokens(t)(),console.log(`[codex-ext/profile-auth] refresh tokens returned`));n!==void 0&&(console.log(`[codex-ext/profile-auth] set auth method`,n),e(n));console.log(`[codex-ext/profile-auth] notify account/updated final`,n??null);await Ts(`handle-app-server-notification-for-host`,{hostId:t,notification:{method:`account/updated`,params:{authMode:n??null}}});console.log(`[codex-ext/profile-auth] refresh done`)}}",
    "function CXRefreshProfileAuthTokens(e){return async()=>{console.log(`[codex-ext/profile-auth] dispatch refresh-auth-token`,e);await CXDispatchMainRequest(`codex-app-server-refresh-auth-token`,{hostId:e,refreshToken:!0},`codex-app-server-refresh-auth-token-response`);console.log(`[codex-ext/profile-auth] dispatch refresh-auth-token returned`,e)}}",
    "function CXSelectProfileMenuItem({item:e,context:t,onClose:n,nested:r,flyout:i}){let a=CXProfileMenuLeftIcon(e),o=()=>{console.log(`[codex-ext/profile-menu] select`,{id:e.id,label:e.label,type:e.type});try{let n=e.onSelect?.(t);n?.then?.(()=>console.log(`[codex-ext/profile-menu] select resolved`,e.id));n?.catch?.(e=>console.error(`[codex-ext/profile-menu] select rejected`,e))}catch(e){console.error(e)}e.closeMenu!==!1&&n?.(!1)};return i?(0,PR.jsx)(wm.Item,{LeftIcon:a,disabled:e.disabled===!0,onSelect:o,children:(0,PR.jsx)(CXProfileMenuLabel,{label:e.label})}):(0,PR.jsx)(Nc,{LeftIcon:a,disabled:e.disabled===!0,onClick:o,children:(0,PR.jsx)(CXProfileMenuLabel,{label:e.label,nested:r})})}",
    "function CXExpandableProfileMenuButton({item:e,expanded:t,onToggle:n}){let r=CXProfileMenuLeftIcon(e),i=r?r():null,a=e=>{e.preventDefault(),e.stopPropagation(),n()},o=e=>e.stopPropagation();return(0,PR.jsxs)(`button`,{type:`button`,disabled:e.disabled===!0,className:`flex min-h-8 w-full cursor-interaction items-center gap-2 rounded-lg px-2 py-1 text-left text-sm text-token-foreground outline-none hover:bg-token-list-hover-background focus-visible:bg-token-list-hover-background disabled:cursor-default disabled:opacity-50`,onClick:a,onKeyDown:o,onPointerDown:o,children:[i,(0,PR.jsx)(CXProfileMenuContent,{label:e.label,expanded:t})]})}",
    "function CXExpandableProfileMenuItem({item:e,context:t,onClose:n}){let[r,i]=(0,NR.useState)(e.defaultExpanded===!0);return(0,PR.jsxs)(PR.Fragment,{children:[(0,PR.jsx)(CXExpandableProfileMenuButton,{item:e,expanded:r,onToggle:()=>i(e=>!e)}),r?(e.children??[]).map((e,r)=>(0,PR.jsx)(CXRenderProfileMenuItem,{item:e,context:t,onClose:n,nested:!0},e.id??r)):null]})}",
    "function CXRenderProfileMenuItem({item:e,context:t,onClose:n,nested:r,flyout:i}){if(e.type===`separator`)return(0,PR.jsx)(wm.Separator,{});if(e.type===`expandable`)return(0,PR.jsx)(CXExpandableProfileMenuItem,{item:e,context:t,onClose:n});let a=CXProfileMenuLeftIcon(e);if(e.type===`submenu`)return(0,PR.jsx)(wm.FlyoutSubmenuItem,{LeftIcon:a,label:(0,PR.jsx)(CXProfileMenuLabel,{label:e.label}),children:(e.children??[]).map((e,i)=>(0,PR.jsx)(CXRenderProfileMenuItem,{item:e,context:t,onClose:n,nested:!0,flyout:!0},e.id??i))});return(0,PR.jsx)(CXSelectProfileMenuItem,{item:e,context:t,onClose:n,nested:r,flyout:i})}",
    "function CXProfileMenuItems({context:e,onClose:t}){globalThis.extensions?.profileAuth&&e?.refreshAuthState&&(globalThis.extensions.profileAuth.refreshAuthState=e.refreshAuthState);let[n,r]=(0,NR.useState)(0);(0,NR.useEffect)(()=>{let e=null,t=()=>r(e=>e+1),n=()=>{let n=globalThis.extensions?.profileMenus;if(n==null)return!1;e=n.subscribe(t),t();return!0};if(n())return()=>e?.();let i=window.setInterval(()=>{n()&&window.clearInterval(i)},100),a=()=>{n()&&window.clearInterval(i)};return window.addEventListener(`codex-extension-loaded`,a),window.addEventListener(`codex-extension-profile-menu-changed`,a),()=>{window.clearInterval(i),window.removeEventListener(`codex-extension-loaded`,a),window.removeEventListener(`codex-extension-profile-menu-changed`,a),e?.()}},[]);let i=globalThis.extensions?.profileMenus?.getItems(e)??[];return i.length===0?null:(0,PR.jsx)(PR.Fragment,{children:i.map((n,r)=>(0,PR.jsx)(CXRenderProfileMenuItem,{item:n,context:e,onClose:t},n.id??r))})}",
    "",
  ].join("\n");
  menu = replaceOnce(
    menu,
    "function ER(e){let t=(0,MR.c)(216),",
    `${helper}function ER(e){let t=(0,MR.c)(216),`,
    "profile menu helpers",
  );
  menu = replaceOnce(
    menu,
    "ut=async()=>{await oi(r,`use-copilot-auth-if-available`,!1),await Ts(`logout`,{hostId:or}),u(`/login`)}",
    "ut=async()=>{let e=CXRefreshProfileAuthState(y,or);if(await globalThis.extensions?.profileAuth?.handleBeforeLogout?.({authMethod:m,accountId:Me,email:f,refreshAuthState:e})){return}await oi(r,`use-copilot-auth-if-available`,!1),await Ts(`logout`,{hostId:or}),u(`/login`)}",
    "profile menu logout switch",
  );
  menu = replaceOnce(
    menu,
    "children:[mt,yt,wt,Dt,Ot,kt,Mt,Pt,It,Rt,zt]",
    "children:[mt,(0,PR.jsx)(CXProfileMenuItems,{context:{authMethod:m,accountId:Me,email:f,refreshAuthState:CXRefreshProfileAuthState(y,or),startLogin:async()=>{await oi(r,`use-copilot-auth-if-available`,!1),await Ts(`logout`,{hostId:or});u(`/login`);let e=new AbortController;globalThis.extensions?.profileAuth?.setActiveLoginCancel?.(()=>e.abort());try{let t=await Ts(`login-with-chatgpt`,{abortController:e});t?.authUrl&&rc({href:t.authUrl,initiator:`open_in_browser_bridge`,openTarget:`external-browser`});let n=await t?.completion;return n?.success&&(y(`chatgpt`),await Ts(`handle-app-server-notification-for-host`,{hostId:or,notification:{method:`account/updated`,params:{authMode:`chatgpt`}}})),n}finally{globalThis.extensions?.profileAuth?.setActiveLoginCancel?.(null)}}},onClose:l}),yt,wt,Dt,Ot,kt,Mt,Pt,It,Rt,zt]",
    "profile menu insertion",
  );
  write(target, menu);
}

function patchLoginRoute() {
  const target = loginRouteFile();
  let route = read(target);
  const helper = [
    "function CXLoginRouteActionButton({action:e}){let t=()=>{try{let t=e.onSelect?.({pathname:window.location.pathname});t?.catch?.(console.error)}catch(e){console.error(e)}};return(0,zt.jsx)(`button`,{type:`button`,disabled:e.disabled===!0,className:`h-9 rounded-full border border-token-border bg-token-main-surface-primary px-4 text-sm font-medium text-token-foreground shadow-sm hover:bg-token-list-hover-background disabled:opacity-50`,onClick:t,children:e.label})}",
    "function CXLoginRouteActions(){let[e,t]=(0,Q.useState)(0);(0,Q.useEffect)(()=>{let e=null,n=()=>t(e=>e+1),r=()=>{let t=globalThis.extensions?.loginRoute;if(t==null)return!1;e=t.subscribe(n),n();return!0};if(r())return()=>e?.();let i=window.setInterval(()=>{r()&&window.clearInterval(i)},100),a=()=>{r()&&window.clearInterval(i)};return window.addEventListener(`codex-extension-loaded`,a),window.addEventListener(`codex-extension-login-route-actions-changed`,a),()=>{window.clearInterval(i),window.removeEventListener(`codex-extension-loaded`,a),window.removeEventListener(`codex-extension-login-route-actions-changed`,a),e?.()}},[]);let n=globalThis.extensions?.loginRoute?.getActions({pathname:window.location.pathname})??[];return n.length===0?null:(0,zt.jsx)(`div`,{className:`fixed top-6 right-6 z-[2147483647] flex items-center gap-2`,children:n.map((e,t)=>(0,zt.jsx)(CXLoginRouteActionButton,{action:e},e.id??t))})}",
    "",
  ].join("\n");
  route = replaceOnce(
    route,
    "function Lt(){let e=(0,Rt.c)(3);",
    `${helper}function Lt(){let e=(0,Rt.c)(3);`,
    "login route helpers",
  );
  route = replaceOnce(
    route,
    "t=(0,zt.jsx)(Pt,{})",
    "t=(0,zt.jsxs)(zt.Fragment,{children:[(0,zt.jsx)(CXLoginRouteActions,{}),(0,zt.jsx)(Pt,{})]})",
    "login route action insertion",
  );
  write(target, route);
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
  const registryPath = path.join(extensionsRoot(), "settings.json");
  let registry = {};
  try {
    registry = JSON.parse(read(registryPath));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  for (const extensionId of ["thread-colors", "account-switcher"]) {
    const extensionRoot = path.join(extensionsRoot(), extensionId);
    fs.mkdirSync(path.join(extensionRoot, "src"), { recursive: true });
    fs.copyFileSync(
      path.join(root, "extensions/extensions", extensionId, "src/main.js"),
      path.join(extensionRoot, "src/main.js"),
    );
    registry[extensionId] = { enabled: true };
  }
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
patchAppServerTransportKill();
patchThreadOverflowMenu();
patchLoginRoute();
patchProfileMenu();
patchBrowserUsePeerAuthorization();
installRuntimeExtensions();
run("codesign", ["--force", "--deep", "--sign", "-", modified]);
run("codesign", ["--verify", "--deep", "--strict", modified]);
run("node", ["--check", path.join(modified, "Contents/Resources/default_app/main.js")]);
run("node", ["--check", path.join(vite, "extension-paths.js")]);
run("node", ["--check", preloadFile]);
run("node", ["--check", mainFile()]);
run("node", ["--check", menuFile()]);
run("node", ["--check", profileMenuFile()]);
run("node", ["--check", loginRouteFile()]);
console.log(modified);

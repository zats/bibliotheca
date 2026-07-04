const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "../..");
const version = "26.623.81905";
const original = path.join(root, `apps/Codex-${version}.original.app`);
const modified = path.join(root, `apps/Codex-${version}.modified.app`);
const webview = path.join(modified, "Contents/Resources/app/webview");
const vite = path.join(modified, "Contents/Resources/app/.vite/build");
const menuFile = path.join(webview, "assets/thread-overflow-menu-CeI5JFwo.js");
const preloadFile = path.join(vite, "preload.js");
const mainFile = path.join(vite, "main-CNod9zFW.js");

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

function resetModifiedApp() {
  if (fs.existsSync(modified)) {
    run("trash", [modified]);
  }
  run("ditto", [original, modified]);
}

function restoreNativeExecutableBits() {
  const nativeRelease = path.join(
    modified,
    "Contents/Resources/app/node_modules/node-pty/build/Release",
  );
  run("chmod", ["+x", path.join(nativeRelease, "pty.node"), path.join(nativeRelease, "spawn-helper")]);
}

function patchWebviewLoader() {
  fs.copyFileSync(
    path.join(root, "src/infrastructure/webview-extension-loader.js"),
    path.join(webview, "codex-extension-loader.js"),
  );

  const htmlFile = path.join(webview, "index.html");
  let html = read(htmlFile);
  html = replaceOnce(
    html,
    '<script type="module" crossorigin src="./assets/index-CUYAyYU6.js"></script>',
    '<script defer src="./codex-extension-loader.js"></script>\n    <script type="module" crossorigin src="./assets/index-CUYAyYU6.js"></script>',
    "webview loader script",
  );
  html = replaceOnce(html, "script-src &#39;self&#39;", "script-src &#39;self&#39; blob:", "webview CSP");
  write(htmlFile, html);
}

function patchPreloadBridge() {
  let preload = read(preloadFile);
  preload = replaceOnce(
    preload,
    "showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})},",
    "showApplicationMenu:async(t,n,i)=>{await e.ipcRenderer.invoke(r,{menuId:t,x:n,y:i})},extensions:{readExtensionRegistry:()=>e.ipcRenderer.invoke(`codex_extensions:read-extension-registry`),readExtensionScript:t=>e.ipcRenderer.invoke(`codex_extensions:read-extension-script`,t),readSettings:t=>e.ipcRenderer.invoke(`codex_extensions:read-settings`,t),writeSettings:(t,n)=>e.ipcRenderer.invoke(`codex_extensions:write-settings`,t,n)},",
    "preload extension bridge",
  );
  write(preloadFile, preload);
}

function patchMainIpc() {
  write(mainFile, `${read(mainFile)}\n${read(path.join(root, "src/infrastructure/main-extension-ipc.js"))}`);
}

function patchThreadOverflowMenu() {
  let menu = read(menuFile);
  const helper = [
    "function CXThreadContext({context:e}){return(0,Q.useEffect)(()=>{globalThis.extensions?.threadContext?.setCurrent(e)},[e]),null}",
    "function CXMenuIcon({icon:e}){return e?.type===`dot`?(0,$.jsx)(`span`,{style:{width:18,height:18,display:`inline-flex`,alignItems:`center`,justifyContent:`center`,flex:`0 0 auto`},children:(0,$.jsx)(`span`,{style:{width:10,height:10,borderRadius:999,background:e.color??`#bdbdbd`}})}):null}",
    "function CXCheckIcon(){return(0,$.jsx)(`span`,{style:{fontSize:18,fontWeight:500,lineHeight:1},children:String.fromCharCode(10003)})}",
    "function CXMenuLabel({label:e}){return(0,$.jsx)(`span`,{children:e})}",
    "function CXRenderMenuItem({item:e,context:t}){if(e.type===`separator`)return(0,$.jsx)(d.Separator,{});let n=e.icon?()=>{return(0,$.jsx)(CXMenuIcon,{icon:e.icon})}:void 0;if(e.type===`submenu`)return(0,$.jsx)(d.FlyoutSubmenuItem,{LeftIcon:n,label:(0,$.jsx)(CXMenuLabel,{label:e.label}),children:(e.children??[]).map((e,n)=>(0,$.jsx)(CXRenderMenuItem,{item:e,context:t},e.id??n))});return(0,$.jsx)(d.Item,{onSelect:()=>e.onSelect?.(t),LeftIcon:n,RightIcon:e.checked?CXCheckIcon:void 0,disabled:e.disabled===!0,children:(0,$.jsx)(CXMenuLabel,{label:e.label})})}",
    "function CXThreadMenuItems({context:e}){let[t,n]=(0,Q.useState)(0);(0,Q.useEffect)(()=>{let e=null,t=()=>n(e=>e+1),r=()=>{let n=globalThis.extensions?.threadMenus;if(n==null)return!1;e=n.subscribe(t),t();return!0};if(r())return()=>e?.();let i=window.setInterval(()=>{r()&&window.clearInterval(i)},100),a=()=>{r()&&window.clearInterval(i)};return window.addEventListener(`codex-extension-loaded`,a),window.addEventListener(`codex-extension-thread-menu-changed`,a),()=>{window.clearInterval(i),window.removeEventListener(`codex-extension-loaded`,a),window.removeEventListener(`codex-extension-thread-menu-changed`,a),e?.()}},[]);let r=globalThis.extensions?.threadMenus?.getItems(e)??[];return r.map((t,n)=>(0,$.jsx)(CXRenderMenuItem,{item:t,context:e},`${t.extensionId??`extension`}:${t.id??n}`))}",
    "",
  ].join("\n");
  const context =
    "{conversationId:e,cwd:s??null,title:c??null,canPin:l,isPinned:F,isWorktreeThread:p,hasSideChatTab:a!=null,canOpenSideChat:V,canFork:lt,canForkIntoWorktree:Ye,canAddScheduledTask:Ve,canOpenInNewWindow:R,isTurnInProgress:Y,archiveNavigation:h,archiveSource:v}";

  menu = replaceOnce(menu, "function mt({conversationId:e,", `${helper}function mt({conversationId:e,`, "menu helpers");
  menu = replaceOnce(
    menu,
    "return(0,$.jsxs)($.Fragment,{children:[(0,$.jsxs)(oe,{open:P,onOpenChange:ye,triggerButton:",
    `return(0,$.jsxs)($.Fragment,{children:[(0,$.jsx)(CXThreadContext,{context:${context}}),(0,$.jsxs)(oe,{open:P,onOpenChange:ye,triggerButton:`,
    "thread context insertion",
  );
  menu = replaceOnce(
    menu,
    "children:(0,$.jsx)(u,{...L.archiveThread})}),null,(0,$.jsx)(d.Separator,{})",
    `children:(0,$.jsx)(u,{...L.archiveThread})}),(0,$.jsx)(CXThreadMenuItems,{context:${context}}),(0,$.jsx)(d.Separator,{})`,
    "thread menu insertion",
  );
  write(menuFile, menu);
}

function installRuntimeExtensions() {
  const extensionId = "thread-colors";
  const extensionRoot = path.join(process.env.HOME, ".codex/extensions", extensionId);
  fs.mkdirSync(path.join(extensionRoot, "src"), { recursive: true });
  fs.copyFileSync(
    path.join(root, "src/extensions/thread-colors/src/main.js"),
    path.join(extensionRoot, "src/main.js"),
  );

  const registryPath = path.join(process.env.HOME, ".codex/extensions/settings.json");
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
restoreNativeExecutableBits();
patchWebviewLoader();
patchPreloadBridge();
patchMainIpc();
patchThreadOverflowMenu();
installRuntimeExtensions();

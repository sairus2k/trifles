import "./index.css";
import { render } from "@solidjs/web";
import { App } from "./app";
import { startSync } from "./sync/engine";

// sw.js only exists in a build (sw-plugin.ts).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
  });
}

startSync();
render(() => <App />, document.getElementById("root")!);

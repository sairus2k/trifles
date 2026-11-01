import { render } from "@solidjs/web";
import { App } from "./app";
import { startSync } from "./sync/engine";

startSync();
render(() => <App />, document.getElementById("root")!);

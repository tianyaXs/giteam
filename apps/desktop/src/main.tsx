import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { App } from "./App";
import "./styles/shadcn.css";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

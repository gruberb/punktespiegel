import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./acorn/tokens.css";
import "./acorn/base.css";
import "./acorn/segmented-control.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";
import { Home, isHub } from "./components/home";
import "./lib/shell";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isHub ? <Home /> : <App />}
  </StrictMode>,
);

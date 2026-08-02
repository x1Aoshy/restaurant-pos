import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Geist Sans/Mono are imported from index.css, alongside the Tailwind theme.
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

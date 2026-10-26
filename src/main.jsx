import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import StagingBadge, { IS_STAGING } from "./components/StagingBadge.jsx";
import "./styles.css";

if (IS_STAGING) document.title = `[Staging] ${document.title}`;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StagingBadge />
    <App />
  </React.StrictMode>
);
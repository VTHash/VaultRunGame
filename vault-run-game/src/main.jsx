import React from "react";
import ReactDOM from "react-dom/client";
import "./reown";
import "./index.css";
// IMPORTANT: initialize AppKit before rendering App
import App from "./App.jsx";
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/index.css";

// Register the root element for the React application
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "Fatal: Root element not found. Ensure index.html contains <div id='root'></div>.",
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
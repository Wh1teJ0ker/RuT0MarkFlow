import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { logger } from "./services/logger";
import "./styles/index.css";

// Install global error handlers before React renders
window.addEventListener("error", (event) => {
  logger.error("Uncaught error", {
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  logger.error("Unhandled promise rejection", {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

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
import React from "react";
import { createRoot } from "react-dom/client";
import { PearlApp } from "./PearlApp";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PearlApp />
  </React.StrictMode>,
);

import React from "react";
import { createRoot } from "react-dom/client";
import Home from "./components/race-app";
import Viewer from "./components/viewer";
import Editor from "./components/editor";
import "./app/globals.css";
const path = window.location.pathname;
const viewer = path.match(/^\/r\/([a-f0-9-]{36})\/?$/i),
  edit = path.match(/^\/edit\/([a-f0-9-]{36})\/?$/i);
createRoot(document.getElementById("root")!).render(
  path === "/demo" ? (
    <Viewer id="demo" />
  ) : viewer ? (
    <Viewer id={viewer[1].toLowerCase()} />
  ) : edit ? (
    <Editor token={edit[1].toLowerCase()} />
  ) : path === "/setup" ? (
    <Editor />
  ) : path === "/" ? (
    <Home />
  ) : (
    <main className="intro">
      <h1>Page not found</h1>
      <a className="textlink" href="/">
        Back to Milemark
      </a>
    </main>
  ),
);

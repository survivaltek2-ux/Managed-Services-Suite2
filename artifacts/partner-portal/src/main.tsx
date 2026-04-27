import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installForceLogoutInterceptor } from "./lib/forceLogoutInterceptor";

installForceLogoutInterceptor();

createRoot(document.getElementById("root")!).render(<App />);

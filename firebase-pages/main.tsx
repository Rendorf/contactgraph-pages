import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";
import { AuthProvider } from "./auth-context";
import { Toaster } from "@/components/ui/sonner";
import { installFirebaseApi } from "./api";

installFirebaseApi();
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root.");
createRoot(root).render(<AuthProvider><Home /><Toaster position="top-right" richColors closeButton duration={6000} /></AuthProvider>);
if ("serviceWorker" in navigator) window.addEventListener("load", () => {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => undefined);
});

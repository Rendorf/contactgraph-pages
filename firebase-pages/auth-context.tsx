import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { GoogleAuthProvider, browserLocalPersistence, browserSessionPersistence, onAuthStateChanged, setPersistence, signInWithPopup, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { auth, configured, db, isTrustedDevice } from "./firebase";
import { resetFirebaseApi } from "./api";

type User = { id: string; username: string; display_name: string; role_id: string; permissions: string[]; must_change_password: false; auth_source: "google" };
type AuthState = { user: User | null; offline: boolean; can: (permission: string) => boolean; refresh: () => Promise<void> };
const AuthContext = createContext<AuthState>({ user: null, offline: false, can: () => false, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

// These capabilities require a private server and are deliberately unavailable on Spark.
const unavailable = new Set(["osint.view", "osint.manage", "sync.read", "sync.write"]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!auth || !db) return;
    let stopMember: (() => void) | undefined;
    let stopRole: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, (firebaseUser) => {
      resetFirebaseApi();
      stopMember?.(); stopRole?.(); stopMember = undefined; stopRole = undefined;
      setUser(null);
      if (!firebaseUser?.email || !firebaseUser.emailVerified || !firebaseUser.providerData.some((provider) => provider.providerId === "google.com")) {
        setLoading(false);
        return;
      }
      const email = firebaseUser.email.toLowerCase();
      stopMember = onSnapshot(doc(db!, "members", email), (memberSnap) => {
        stopRole?.(); stopRole = undefined;
        setUser(null);
        setLoading(true);
        if (!memberSnap.exists() || memberSnap.data().active !== true) {
          setError("This Google account is not approved for ContactGraph.");
          void signOut(auth!);
          setLoading(false);
          return;
        }
        const member = memberSnap.data();
        if (typeof member.role_id !== "string") { setError("This account has no valid role."); setLoading(false); return; }
        stopRole = onSnapshot(doc(db!, "roles", member.role_id), (roleSnap) => {
          if (!roleSnap.exists() && member.role_id !== "owner") { setError("This account has no valid role."); setLoading(false); return; }
          const permissions = member.role_id === "owner" ? ["*"] : roleSnap.data()?.permissions;
          if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== "string")) { setError("This account has no valid role."); setLoading(false); return; }
          setUser({ id: firebaseUser.uid, username: member.username || email, display_name: member.display_name || email, role_id: member.role_id, permissions, must_change_password: false, auth_source: "google" });
          setError(""); setLoading(false);
        }, () => { setUser(null); setError("Access could not be verified."); setLoading(false); void signOut(auth!); });
      }, () => { setUser(null); setError("Access could not be verified."); setLoading(false); void signOut(auth!); });
    });
    return () => { stopMember?.(); stopRole?.(); stopAuth(); };
  }, [generation]);

  const refresh = useCallback(async () => { setGeneration((value) => value + 1); }, []);
  const can = (permission: string) => Boolean(user && !unavailable.has(permission) && (user.permissions.includes("*") || user.permissions.includes(permission)));
  const login = async () => {
    if (!auth) return;
    setError("");
    try {
      await setPersistence(auth, isTrustedDevice() ? browserLocalPersistence : browserSessionPersistence);
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Google sign-in failed."); }
  };

  if (!configured) return <div className="auth-screen"><div className="auth-card"><h1>Firebase setup required</h1><p>The Pages build needs its Firebase project configuration before it can open private data.</p></div></div>;
  if (loading) return <div className="auth-screen">Checking access…</div>;
  if (!user) return <div className="auth-screen"><div className="auth-card"><h1>ContactGraph</h1><p>Sign in with an approved Google account.</p>{error && <p role="alert" className="auth-error">{error}</p>}<Button onClick={() => void login()}>Continue with Google</Button></div></div>;
  return <AuthContext.Provider value={{ user, offline: false, can, refresh }}>{children}</AuthContext.Provider>;
}

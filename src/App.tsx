import { useEffect, useState } from "react";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import "./index.css";

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if user is already authenticated
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/check");
        const data = await res.json();
        setIsAuthenticated(data.authenticated);
      } catch {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, []);

  // Loading state
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return <Dashboard onLogout={() => setIsAuthenticated(false)} />;
}

export default App;

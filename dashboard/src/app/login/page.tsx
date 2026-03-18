"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Identifiants incorrects ou API hors ligne");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9F9F9] px-4 py-12">
      <div 
        className="w-full max-w-[400px] bg-white border border-[#E5E7EB] rounded-[12px] p-10"
        style={{ boxShadow: 'none' }}
      >
        <div className="text-center">
          <h2 className="font-bold text-[22px] mb-2 text-zinc-900">Influence.</h2>
          <h3 className="text-[20px] font-bold text-zinc-900">Welcome back</h3>
          <p className="text-[14px] text-[#6B7280] mt-1 mb-7">Sign in to your workspace</p>
        </div>
        
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-50 p-4 mb-4">
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          )}
          
          <div className="space-y-3">
            <div>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="w-full rounded-[8px] border border-[#E5E7EB] bg-white py-2.5 px-3.5 text-sm transition-colors placeholder:text-muted-foreground focus:border-[#000000] focus:outline-none"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                className="w-full rounded-[8px] border border-[#E5E7EB] bg-white py-2.5 pr-10 px-3.5 text-sm transition-colors placeholder:text-muted-foreground focus:border-[#000000] focus:outline-none"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="mt-5">
            <PrimaryButton 
              type="submit" 
              disabled={loading}
              className="w-full py-3"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Se connecter"}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}

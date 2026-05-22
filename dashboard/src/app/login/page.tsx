"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useLocale } from "@/components/i18n/LocaleProvider";

export default function LoginPage() {
  const { text } = useLocale();
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
      setError(text.login.invalidCredentials);
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-50 to-zinc-100 px-4 py-12">
      <div
        className="w-full max-w-[420px] rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-200/60"
      >
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
            Influence Platform
          </div>
          <h2 className="text-[26px] font-bold tracking-tight text-zinc-900">Influence.</h2>
          <h3 className="mt-1 text-[20px] font-semibold text-zinc-900">{text.login.welcomeBack}</h3>
          <p className="mt-1 text-sm text-zinc-600">{text.login.signInWorkspace}</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          )}

          <div className="space-y-3.5">
            <div>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                placeholder={text.login.username}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                style={{ WebkitTextFillColor: "#111827" }}
              />
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 pr-10 text-sm text-zinc-900 transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                placeholder={text.login.password}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ WebkitTextFillColor: "#111827" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-700"
                aria-label={showPassword ? text.login.hidePassword : text.login.showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="mt-6">
            <PrimaryButton type="submit" disabled={loading} className="w-full py-3">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : text.login.signIn}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}

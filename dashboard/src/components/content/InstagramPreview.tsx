"use client";

import { Heart, MessageCircle, Send, Bookmark, Copy, Check, MoreHorizontal } from "lucide-react";
import { useState } from "react";

interface InstagramPreviewProps {
  username?: string;
  caption: string;
  hashtags?: string[];
  visualUrl?: string | null;
  niche: string;
  type: string;
}

export function InstagramPreview({
  username = "account",
  caption,
  hashtags = [],
  visualUrl,
  niche,
  type,
}: InstagramPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);

  const fullCaption = [
    caption,
    "",
    hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "),
  ]
    .filter(Boolean)
    .join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullCaption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="w-full max-w-[375px] mx-auto bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-100 dark:border-neutral-800">
        <div className="flex items-center gap-2.5">
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 via-red-500 to-yellow-500 p-[2px]">
            <div className="w-full h-full rounded-full bg-white dark:bg-neutral-900 flex items-center justify-center">
              <span className="text-[10px] font-bold text-neutral-600 dark:text-neutral-300">
                {username.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-tight text-neutral-900 dark:text-neutral-100">
              {username}
            </p>
            <p className="text-[10px] text-neutral-400">{niche}</p>
          </div>
        </div>
        <MoreHorizontal className="w-5 h-5 text-neutral-400" />
      </div>

      {/* Image area */}
      <div className="relative w-full aspect-square bg-neutral-100 dark:bg-neutral-800">
        {visualUrl ? (
          <img
            src={visualUrl}
            alt="Generated visual"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-neutral-400 dark:text-neutral-500 gap-2">
            <div className="w-12 h-12 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
              <span className="text-2xl">📷</span>
            </div>
            <p className="text-xs font-medium text-center px-4">
              Visual en cours de génération
            </p>
          </div>
        )}
        {/* Type badge */}
        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-md bg-black/60 text-[10px] font-bold text-white uppercase tracking-wide">
          {type}
        </span>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-4">
          <button onClick={() => setLiked(!liked)} className="transition-transform active:scale-125">
            <Heart
              className={`w-6 h-6 transition-colors ${
                liked
                  ? "fill-red-500 text-red-500"
                  : "text-neutral-800 dark:text-neutral-200"
              }`}
            />
          </button>
          <MessageCircle className="w-6 h-6 text-neutral-800 dark:text-neutral-200 -scale-x-100" />
          <Send className="w-5 h-5 text-neutral-800 dark:text-neutral-200 -rotate-12" />
        </div>
        <Bookmark className="w-6 h-6 text-neutral-800 dark:text-neutral-200" />
      </div>

      {/* Caption */}
      <div className="px-3 pb-2">
        <p className="text-[13px] leading-[18px] text-neutral-900 dark:text-neutral-100">
          <span className="font-semibold mr-1">{username}</span>
          {caption.length > 120 ? caption.slice(0, 120) + "..." : caption}
        </p>
      </div>

      {/* Hashtags */}
      {hashtags.length > 0 && (
        <div className="px-3 pb-2">
          <p className="text-[13px] leading-[18px] text-blue-500 dark:text-blue-400">
            {hashtags
              .slice(0, 8)
              .map((h) => (h.startsWith("#") ? h : `#${h}`))
              .join(" ")}
          </p>
        </div>
      )}

      {/* Timestamp */}
      <div className="px-3 pb-3">
        <p className="text-[10px] text-neutral-400 uppercase tracking-wide">
          Maintenant
        </p>
      </div>

      {/* Copy button */}
      <div className="border-t border-neutral-100 dark:border-neutral-800 px-3 py-2.5">
        <button
          onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-sm font-medium text-neutral-700 dark:text-neutral-300 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-green-500" /> Copié !
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" /> Copier le caption
            </>
          )}
        </button>
      </div>
    </div>
  );
}

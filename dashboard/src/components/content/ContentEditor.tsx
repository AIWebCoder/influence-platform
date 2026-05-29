"use client";

import { useState } from "react";
import { X, Plus, Save, Loader2 } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";

interface ContentEditorProps {
  contentId: string;
  initialCaption: string;
  initialHashtags: string[];
  onSave: (id: string, caption: string, hashtags: string[]) => Promise<void>;
  onClose: () => void;
}

const MAX_CAPTION_LENGTH = 2200;

export function ContentEditor({
  contentId,
  initialCaption,
  initialHashtags,
  onSave,
  onClose,
}: ContentEditorProps) {
  const { text } = useLocale();
  const ce = text.contentEditor;
  const [caption, setCaption] = useState(initialCaption);
  const [hashtags, setHashtags] = useState<string[]>(initialHashtags);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);

  const remaining = MAX_CAPTION_LENGTH - caption.length;

  const addHashtag = () => {
    const tag = newTag.trim().replace(/^#/, "");
    if (tag && !hashtags.includes(tag)) {
      setHashtags([...hashtags, tag]);
      setNewTag("");
    }
  };

  const removeHashtag = (tag: string) => {
    setHashtags(hashtags.filter((h) => h !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addHashtag();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(contentId, caption, hashtags);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
        <h3 className="text-sm font-bold text-neutral-700 dark:text-neutral-200">{ce.title}</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-500">
            {ce.caption}
          </label>
          <textarea
            value={caption}
            onChange={(e) => {
              if (e.target.value.length <= MAX_CAPTION_LENGTH) {
                setCaption(e.target.value);
              }
            }}
            rows={6}
            className="w-full p-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none transition-shadow"
            placeholder={ce.captionPlaceholder}
          />
          <div className="flex justify-end">
            <span
              className={`text-xs font-medium ${
                remaining < 100
                  ? remaining < 0
                    ? "text-red-500"
                    : "text-amber-500"
                  : "text-neutral-400"
              }`}
            >
              {remaining} / {MAX_CAPTION_LENGTH}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-500">
            {ce.hashtags}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {hashtags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-medium border border-blue-200 dark:border-blue-800"
              >
                #{tag}
                <button
                  onClick={() => removeHashtag(tag)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow"
              placeholder={ce.hashtagPlaceholder}
            />
            <button
              onClick={addHashtag}
              disabled={!newTag.trim()}
              className="px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700">
        <button
          onClick={handleSave}
          disabled={saving || caption.length === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {ce.saveQueue}
        </button>
      </div>
    </div>
  );
}

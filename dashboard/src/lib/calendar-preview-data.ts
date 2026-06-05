import { addDays, setHours, setMinutes, startOfMonth, startOfWeek } from "date-fns";

export type CalendarPreviewItem = {
  id: string;
  generation_job_id?: string | null;
  caption?: string | null;
  visual_url?: string | null;
  scheduled_at?: string | null;
  niche?: string | null;
  status: string;
  mode?: string;
  content_type?: string;
  target_count?: number;
};

export const CALENDAR_PREVIEW_ID_PREFIX = "preview-";

export function isCalendarPreviewItem(id: string) {
  return id.startsWith(CALENDAR_PREVIEW_ID_PREFIX);
}

function at(day: Date, hour: number, minute = 0) {
  return setMinutes(setHours(day, hour), minute).toISOString();
}

export function buildCalendarPreviewItems(
  anchor: Date,
  viewMode: "week" | "month",
  nicheFilter?: string,
): CalendarPreviewItem[] {
  const weekSamples = buildWeekPreviewItems(anchor, nicheFilter);
  if (viewMode === "week") {
    return weekSamples;
  }

  const monthStart = startOfMonth(anchor);
  const monthExtras: CalendarPreviewItem[] = [
    {
      id: "preview-month-tech-reel",
      caption: "Monthly recap reel - product updates and metrics",
      niche: "tech",
      status: "ready",
      mode: "scheduled",
      content_type: "reel",
      scheduled_at: at(addDays(monthStart, 7), 16, 0),
      target_count: 2,
    },
    {
      id: "preview-month-food-post",
      caption: "Seasonal recipe post - summer salads",
      niche: "food",
      status: "queued",
      mode: "scheduled",
      content_type: "post",
      scheduled_at: at(addDays(monthStart, 14), 12, 0),
      target_count: 1,
    },
    {
      id: "preview-month-fitness-story",
      caption: "Challenge kickoff story - 7-day habit streak",
      niche: "fitness",
      status: "ready",
      mode: "scheduled",
      content_type: "story",
      scheduled_at: at(addDays(monthStart, 21), 8, 30),
      target_count: 1,
    },
  ];

  const merged = [...weekSamples];
  for (const extra of monthExtras) {
    if (!merged.some((s) => s.id === extra.id)) {
      merged.push(extra);
    }
  }
  return filterByNiche(merged, nicheFilter);
}

function filterByNiche(samples: CalendarPreviewItem[], nicheFilter?: string) {
  if (nicheFilter && nicheFilter !== "all") {
    return samples.filter((s) => s.niche === nicheFilter);
  }
  return samples;
}

function buildWeekPreviewItems(weekAnchor: Date, nicheFilter?: string): CalendarPreviewItem[] {
  const monday = startOfWeek(weekAnchor, { weekStartsOn: 1 });
  const wednesday = addDays(monday, 2);
  const samples: CalendarPreviewItem[] = [
    {
      id: "preview-fitness-reel-mon",
      generation_job_id: "00000000-0000-4000-8000-000000000101",
      caption: "Morning mobility reel - 5 stretches before your desk day",
      niche: "fitness",
      status: "ready",
      mode: "scheduled",
      content_type: "reel",
      scheduled_at: at(addDays(monday, 0), 10, 0),
      target_count: 2,
    },
    {
      id: "preview-food-reel-mon-pm",
      caption: "Afternoon snack reel - 3 high-protein options",
      niche: "food",
      status: "ready",
      mode: "scheduled",
      content_type: "reel",
      scheduled_at: at(addDays(monday, 0), 16, 45),
      target_count: 1,
    },
    {
      id: "preview-fitness-reel-wed-am",
      caption: "Quick HIIT warm-up before midweek meetings",
      niche: "fitness",
      status: "ready",
      mode: "scheduled",
      content_type: "reel",
      scheduled_at: at(wednesday, 8, 0),
      target_count: 2,
    },
    {
      id: "preview-business-post-wed-noon",
      caption: "Midweek carousel - 4 metrics founders should track",
      niche: "business",
      status: "ready",
      mode: "scheduled",
      content_type: "post",
      scheduled_at: at(wednesday, 12, 15),
      target_count: 1,
    },
    {
      id: "preview-food-post-wed",
      generation_job_id: "00000000-0000-4000-8000-000000000102",
      caption: "High-protein meal prep carousel for busy weekdays",
      niche: "food",
      status: "queued",
      mode: "scheduled",
      content_type: "post",
      scheduled_at: at(wednesday, 14, 30),
      target_count: 1,
    },
    {
      id: "preview-lifestyle-story-wed-eve",
      caption: "Evening wind-down story - desk to dinner routine",
      niche: "lifestyle",
      status: "ready",
      mode: "scheduled",
      content_type: "story",
      scheduled_at: at(wednesday, 19, 0),
      target_count: 1,
    },
    {
      id: "preview-business-reel-fri",
      caption: "B2B founder tip: ship one marketing experiment per week",
      niche: "business",
      status: "ready",
      mode: "scheduled",
      content_type: "reel",
      scheduled_at: at(addDays(monday, 4), 9, 15),
      target_count: 3,
    },
    {
      id: "preview-lifestyle-story-sat",
      caption: "Weekend reset story - slow coffee and inbox zero",
      niche: "lifestyle",
      status: "published",
      mode: "scheduled",
      content_type: "story",
      scheduled_at: at(addDays(monday, 5), 18, 0),
      target_count: 1,
    },
    {
      id: "preview-travel-reel-sun",
      caption: "Budget Lisbon day trip - 3 spots under 20 EUR",
      niche: "travel",
      status: "ready",
      mode: "scheduled",
      content_type: "reel",
      scheduled_at: at(addDays(monday, 6), 11, 45),
      target_count: 2,
    },
    {
      id: "preview-unscheduled-draft",
      caption: "Draft intent - assign a dispatch slot to schedule publish",
      niche: "lifestyle",
      status: "draft",
      mode: "save_for_later",
      content_type: "reel",
      scheduled_at: null,
      target_count: 1,
    },
  ];

  return filterByNiche(samples, nicheFilter);
}

export const calendarPreviewEnabledByEnv =
  String(process.env.NEXT_PUBLIC_CALENDAR_PREVIEW ?? "").toLowerCase() === "true";
export const FINANCIAL_AID_CONTACT = {
  name: "Financial Aid & Scholarships",
  mailingAddress: [
    "BYU-Hawaii #1980",
    "55-220 Kulanui Street Bldg 5",
    "Laie, Hawaii 96762-1294",
  ],
  location: "Lorenzo Snow Administration Building Room 180",
  office: "(808) 675-3316",
  fax: "(808) 675-3323",
  email: "financialaid@byuh.edu",
}

export const SUPPORT_HOURS_NOTE =
  "Live support follows Financial Aid office hours: Mon-Fri, 8 AM-5 PM HST. Closed during devotional (Tue 11 AM–12 PM) and holidays."

export type ClosedReason = "outside_hours" | "devotional" | "holiday"

export type SupportAvailability = {
  isAvailable: boolean
  label: "Live Support" | "Live Support Closed"
  note: string
  closedReason?: ClosedReason
}

// ---------------------------------------------------------------------------
// Hawaii date helpers
// ---------------------------------------------------------------------------
function getHawaiiDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date)

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ""

  return {
    weekday: getPart("weekday"),
    year: Number(getPart("year")),
    month: Number(getPart("month")),   // 1-indexed
    day: Number(getPart("day")),
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
  }
}

// ---------------------------------------------------------------------------
// Holiday computation
//
// Covers US federal holidays observed by BYU–Hawaii + Hawaii state holidays.
// When a fixed-date holiday falls on Saturday the observed date is Friday;
// when it falls on Sunday the observed date is Monday.
// ---------------------------------------------------------------------------
function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  // month: 1-indexed, weekday: 0 = Sun … 6 = Sat
  const date = new Date(year, month - 1, 1)
  let count = 0
  while (date.getDay() !== weekday) date.setDate(date.getDate() + 1)
  while (count < nth - 1) { date.setDate(date.getDate() + 7); count++ }
  return date
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const date = new Date(year, month, 0) // last day of month
  while (date.getDay() !== weekday) date.setDate(date.getDate() - 1)
  return date
}

function observed(y: number, m: number, d: number): Date {
  const date = new Date(y, m - 1, d)
  if (date.getDay() === 6) return new Date(y, m - 1, d - 1) // Sat → Fri
  if (date.getDay() === 0) return new Date(y, m - 1, d + 1) // Sun → Mon
  return date
}

function toYMD(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function getHolidaysForYear(year: number): Set<string> {
  // Day after Thanksgiving = Friday after 4th Thursday in November
  const thanksgiving = nthWeekday(year, 11, 4, 4)
  const dayAfterThanksgiving = new Date(thanksgiving)
  dayAfterThanksgiving.setDate(thanksgiving.getDate() + 1)

  const holidays = [
    observed(year, 1, 1),                     // New Year's Day
    nthWeekday(year, 1, 1, 3),                // MLK Day — 3rd Monday in January
    nthWeekday(year, 2, 1, 3),                // Presidents' Day — 3rd Monday in February
    observed(year, 3, 26),                    // Prince Kuhio Day (Hawaii)
    lastWeekday(year, 5, 1),                  // Memorial Day — last Monday in May
    observed(year, 6, 11),                    // King Kamehameha Day (Hawaii)
    observed(year, 6, 19),                    // Juneteenth
    observed(year, 7, 4),                     // Independence Day
    nthWeekday(year, 8, 5, 3),               // Statehood Day — 3rd Friday in August (Hawaii)
    nthWeekday(year, 9, 1, 1),               // Labor Day — 1st Monday in September
    thanksgiving,                              // Thanksgiving — 4th Thursday in November
    dayAfterThanksgiving,                      // Day after Thanksgiving
    observed(year, 12, 25),                   // Christmas Day
    // New Year's Eve observed if Dec 31 is a weekday (many BYUH offices close)
    observed(year, 12, 31),
  ]

  return new Set(holidays.map(toYMD))
}

// ---------------------------------------------------------------------------
// Main availability function
// ---------------------------------------------------------------------------
export function getSupportAvailability(date = new Date()): SupportAvailability {
  const { weekday, year, month, day, hour, minute } = getHawaiiDateParts(date)

  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday)
  const minutesSinceMidnight = hour * 60 + minute
  const opensAt = 8 * 60        // 8:00 AM
  const closesAt = 17 * 60      // 5:00 PM

  // Holiday check (uses Hawaii local date)
  const holidays = getHolidaysForYear(year)
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  if (holidays.has(dateKey)) {
    return {
      isAvailable: false,
      label: "Live Support Closed",
      note: SUPPORT_HOURS_NOTE,
      closedReason: "holiday",
    }
  }

  if (!isWeekday || minutesSinceMidnight < opensAt || minutesSinceMidnight >= closesAt) {
    return {
      isAvailable: false,
      label: "Live Support Closed",
      note: SUPPORT_HOURS_NOTE,
      closedReason: "outside_hours",
    }
  }

  // Devotional — Tuesday 11:00 AM to 12:00 PM HST
  if (weekday === "Tue" && minutesSinceMidnight >= 11 * 60 && minutesSinceMidnight < 12 * 60) {
    return {
      isAvailable: false,
      label: "Live Support Closed",
      note: SUPPORT_HOURS_NOTE,
      closedReason: "devotional",
    }
  }

  return {
    isAvailable: true,
    label: "Live Support",
    note: SUPPORT_HOURS_NOTE,
  }
}

// ---------------------------------------------------------------------------
// Closed message helpers — give users a specific reason, not just "closed"
// ---------------------------------------------------------------------------
export function getClosedMessage(reason: ClosedReason | undefined): string {
  switch (reason) {
    case "devotional":
      return "Live support is temporarily closed for devotional (Tue 11 AM – 12 PM HST). We'll be back online at noon — feel free to leave your question and an advisor will follow up!"
    case "holiday":
      return "The Financial Aid office is closed today for a holiday. Please check back on the next business day, or reach us at financialaid@byuh.edu."
    case "outside_hours":
    default:
      return "Live support is currently unavailable. Our advisors are online Mon–Fri, 8 AM–5 PM HST (excluding devotional and holidays). You're welcome to ask the chatbot or email us at financialaid@byuh.edu."
  }
}

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
  "Live support follows Financial Aid office hours: Mon-Fri, 8 AM-5 PM HST. Closed during devotional and holidays."

export type SupportAvailability = {
  isAvailable: boolean
  label: "Live Support" | "Live Support Closed"
  note: string
}

function getHawaiiDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date)

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value

  return {
    weekday: getPart("weekday") ?? "",
    hour: Number(getPart("hour") ?? "0"),
    minute: Number(getPart("minute") ?? "0"),
  }
}

export function getSupportAvailability(date = new Date()): SupportAvailability {
  const { weekday, hour, minute } = getHawaiiDateParts(date)
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday)
  const minutesSinceMidnight = hour * 60 + minute
  const opensAt = 8 * 60
  const closesAt = 17 * 60

  const devotionalBlock =
    weekday === "Tue" && minutesSinceMidnight >= 11 * 60 && minutesSinceMidnight < 12 * 60 + 30

  const isAvailable =
    isWeekday && minutesSinceMidnight >= opensAt && minutesSinceMidnight < closesAt && !devotionalBlock

  return {
    isAvailable,
    label: isAvailable ? "Live Support" : "Live Support Closed",
    note: SUPPORT_HOURS_NOTE,
  }
}

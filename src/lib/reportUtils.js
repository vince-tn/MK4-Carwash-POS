export const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

export function csvSafe(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

export function getPeriodKey(dateStr, period) {
  if (!dateStr) return "Unknown";

  if (period === "day") return dateStr;
  if (period === "month") return dateStr.slice(0, 7);

  // Week: use the Monday of that week as the key
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const dayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayOffset);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function formatPeriodLabel(key, period) {
  if (key === "Unknown") return key;
  if (period === "week") return `Week of ${key}`;
  return key;
}

export const periodOptions = [
  { value: "day", label: "Per Day" },
  { value: "week", label: "Per Week" },
  { value: "month", label: "Per Month" },
];

export function downloadCSV(filename, headers, rows) {
  const csvContent = [
    headers.map(csvSafe).join(","),
    ...rows.map((row) => row.map(csvSafe).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

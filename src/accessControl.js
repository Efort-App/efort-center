const ALLOWED_DASHBOARD_EMAILS = new Set([
  "efortapp@gmail.com",
  "testec202405@gmail.com",
]);

export function normalizeEmail(email) {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

export function hasDashboardAccess(user) {
  return ALLOWED_DASHBOARD_EMAILS.has(normalizeEmail(user?.email));
}

export {ALLOWED_DASHBOARD_EMAILS};

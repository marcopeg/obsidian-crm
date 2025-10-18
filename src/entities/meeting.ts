import type { CRMEntityConfig } from "@/types/CRMEntityConfig";

const template = `
date: {{date:YYYY-MM-DD}}
time: {{time:HH:mm}}
location:
participants:
team:
project:
---
# Agenda

# Notes

# Decisions

# Action Items

# Follow Up

`;

const meetingConfig: CRMEntityConfig<
  "meeting",
  | { type: "meeting-navigation" }
  | { type: "facts"; collapsed?: boolean }
> = {
  type: "meeting",
  name: "Meetings",
  icon: "calendar-clock",
  dashboard: {},
  settings: {
    template,
  },
  list: {
    columns: ["date_time", "participants"],
    sort: { column: "date_time", direction: "desc" },
  },
  links: [
    {
      type: "meeting-navigation",
    },
    {
      type: "facts",
    },
  ],
};

export default meetingConfig;

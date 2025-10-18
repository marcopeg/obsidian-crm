import { useCallback, useMemo } from "react";
import { Card } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { useFiles } from "@/hooks/use-files";
import { useApp } from "@/hooks/use-app";
import { CRMFileType } from "@/types/CRMFileType";
import type { TCachedFile } from "@/types/TCachedFile";
import { getEntityDisplayName } from "@/utils/getEntityDisplayName";
import {
  createMeetingForEntity,
  type MeetingLinkTarget,
} from "@/utils/createMeetingForPerson";
import {
  addParticipantLink,
  normalizeParticipantLink,
  parseParticipants,
} from "@/utils/participants";

const getTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toTimestamp = (cached: TCachedFile): number | null => {
  const frontmatter = cached.cache?.frontmatter as
    | Record<string, unknown>
    | undefined;

  if (frontmatter?.datetime instanceof Date) {
    if (!Number.isNaN(frontmatter.datetime.getTime())) {
      return frontmatter.datetime.getTime();
    }
  }

  const fromDateTime = getTrimmedString(frontmatter?.datetime);
  if (fromDateTime) {
    const parsed = new Date(fromDateTime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }

  const fromDateParts = (() => {
    const dateValue = frontmatter?.date;
    const timeValue = frontmatter?.time;

    if (dateValue instanceof Date) {
      return Number.isNaN(dateValue.getTime())
        ? null
        : dateValue.getTime();
    }

    const dateString = getTrimmedString(dateValue);
    if (!dateString) {
      return null;
    }

    const timeString = getTrimmedString(timeValue);
    const hasExplicitTime =
      dateString.includes("T") || dateString.includes(" ");
    const isoCandidate = hasExplicitTime
      ? dateString
      : timeString
      ? `${dateString}T${timeString}`
      : `${dateString}T00:00`;
    const parsed = new Date(isoCandidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
    const fallback = new Date(dateString);
    return Number.isNaN(fallback.getTime()) ? null : fallback.getTime();
  })();

  if (fromDateParts !== null && fromDateParts !== undefined) {
    return fromDateParts;
  }

  const dateTimeFallback = frontmatter?.date_time;
  if (dateTimeFallback instanceof Date) {
    return Number.isNaN(dateTimeFallback.getTime())
      ? null
      : dateTimeFallback.getTime();
  }
  const dateTimeFallbackString = getTrimmedString(dateTimeFallback);
  if (dateTimeFallbackString) {
    const parsed = new Date(dateTimeFallbackString);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }

  const stat = cached.file?.stat;
  const statTimes = [stat?.mtime, stat?.ctime].filter(
    (value): value is number => typeof value === "number" && value > 0
  );
  if (statTimes.length > 0) {
    return Math.max(...statTimes);
  }

  return null;
};

const getParticipants = (cached: TCachedFile): string[] => {
  const frontmatter = cached.cache?.frontmatter as
    | Record<string, unknown>
    | undefined;
  const raw = frontmatter?.participants;
  return parseParticipants(raw).map((value) =>
    normalizeParticipantLink(String(value))
  );
};

type MeetingNavigationLinksProps = {
  config: Record<string, unknown>;
  file: TCachedFile;
};

type NavigationEntry = {
  cached: TCachedFile;
  timestamp: number;
  label: string;
  participants: string[];
};

export const MeetingNavigationLinks = ({ file }: MeetingNavigationLinksProps) => {
  const app = useApp();
  const meetings = useFiles(CRMFileType.MEETING);
  const people = useFiles(CRMFileType.PERSON);

  const currentTimestamp = useMemo(() => toTimestamp(file), [file]);
  const rawCurrentParticipants = useMemo(() => {
    const frontmatter = file.cache?.frontmatter as
      | Record<string, unknown>
      | undefined;
    return parseParticipants(frontmatter?.participants);
  }, [file]);
  const currentParticipants = useMemo(
    () =>
      rawCurrentParticipants
        .map((participant) => normalizeParticipantLink(participant))
        .filter((participant) => participant.length > 0),
    [rawCurrentParticipants]
  );

  const navEntries = useMemo(() => {
    const entries = meetings
      .filter((meeting) => meeting.file?.path !== file.file?.path)
      .map<NavigationEntry | null>((meeting) => {
        const timestamp = toTimestamp(meeting);
        if (timestamp === null) {
          return null;
        }
        const label = getEntityDisplayName(meeting);
        return {
          cached: meeting,
          timestamp,
          label,
          participants: getParticipants(meeting),
        };
      })
      .filter((entry): entry is NavigationEntry => Boolean(entry));

    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries;
  }, [meetings, file]);

  const findPrevious = useCallback(
    (filter?: (entry: NavigationEntry) => boolean) => {
      if (currentTimestamp === null) {
        return undefined;
      }
      const filtered = filter ? navEntries.filter(filter) : navEntries;
      const previous = filtered.filter((entry) => entry.timestamp < currentTimestamp);
      return previous.length > 0 ? previous[previous.length - 1] : undefined;
    },
    [currentTimestamp, navEntries]
  );

  const findNext = useCallback(
    (filter?: (entry: NavigationEntry) => boolean) => {
      if (currentTimestamp === null) {
        return undefined;
      }
      const filtered = filter ? navEntries.filter(filter) : navEntries;
      return filtered.find((entry) => entry.timestamp > currentTimestamp);
    },
    [currentTimestamp, navEntries]
  );

  const singleParticipant = useMemo(
    () => (currentParticipants.length === 1 ? currentParticipants[0] : undefined),
    [currentParticipants]
  );
  const singleParticipantKey = useMemo(
    () => singleParticipant?.toLowerCase(),
    [singleParticipant]
  );
  const singleParticipantRaw = useMemo(
    () => (rawCurrentParticipants.length === 1 ? rawCurrentParticipants[0] : undefined),
    [rawCurrentParticipants]
  );

  const matchedSingleParticipant = useMemo<TCachedFile | undefined>(() => {
    if (!singleParticipant || !singleParticipantKey) {
      return undefined;
    }

    const matchedPerson = people.find((candidate) => {
      const candidatePath = normalizeParticipantLink(candidate.file.path);
      return candidatePath.toLowerCase() === singleParticipantKey;
    });

    if (matchedPerson) {
      return matchedPerson;
    }

    if (!file.file) {
      return undefined;
    }

    const fallbackTarget = app.metadataCache.getFirstLinkpathDest(
      singleParticipant,
      file.file.path
    );

    if (!fallbackTarget) {
      return undefined;
    }

    return {
      file: fallbackTarget,
      cache: app.metadataCache.getCache(fallbackTarget.path) ?? undefined,
    };
  }, [app, file.file, people, singleParticipant, singleParticipantKey]);

  const previousOneOnOne =
    singleParticipantKey !== undefined
      ? findPrevious((entry) =>
          entry.participants.length === 1 &&
          entry.participants[0].toLowerCase() === singleParticipantKey
        )
      : undefined;

  const nextOneOnOne =
    singleParticipantKey !== undefined
      ? findNext((entry) =>
          entry.participants.length === 1 &&
          entry.participants[0].toLowerCase() === singleParticipantKey
        )
      : undefined;
  const hasNext = Boolean(nextOneOnOne);

  const handleCreateMeeting = useCallback(() => {
    const participantTargets: MeetingLinkTarget[] = matchedSingleParticipant
      ? [
          {
            property: "participants",
            mode: "list",
            target: matchedSingleParticipant,
          },
        ]
      : [];

    const entityTarget = matchedSingleParticipant ?? file;

    void (async () => {
      try {
        const meetingFile = await createMeetingForEntity({
          app,
          entityFile: entityTarget,
          linkTargets: participantTargets,
        });

        if (
          !matchedSingleParticipant &&
          meetingFile &&
          singleParticipantRaw &&
          singleParticipantRaw.trim()
        ) {
          await addParticipantLink(app, meetingFile, singleParticipantRaw);
        }
      } catch (error) {
        console.error(
          "MeetingNavigationLinks: failed to create meeting",
          error
        );
      }
    })();
  }, [
    app,
    file,
    matchedSingleParticipant,
    singleParticipantRaw,
  ]);

  if (!singleParticipantKey) {
    return null;
  }

  if (!hasNext) {
    return (
      <Card p={0}>
        <div className="flex items-center justify-end px-3 py-2">
          <Button icon="plus" onClick={handleCreateMeeting}>
            New 1-1
          </Button>
        </div>
      </Card>
    );
  }

  const renderLink = (
    entry: NavigationEntry,
    options?: { icon?: string; iconPosition?: "start" | "end"; ariaLabel?: string }
  ) => (
    <Button
      key={entry.cached.file.path}
      to={entry.cached.file.path}
      variant="link"
      icon={options?.icon}
      iconPosition={options?.iconPosition}
      className="truncate max-w-[14rem]"
      aria-label={options?.ariaLabel ?? entry.label}
    >
      {entry.label}
    </Button>
  );

  const renderOneOnOneLink = (entry: NavigationEntry, position: "previous" | "next") =>
    renderLink(entry, {
      icon: "user",
      iconPosition: position === "previous" ? "start" : "end",
      ariaLabel: `${position === "previous" ? "Previous" : "Next"} 1-1 meeting: ${entry.label}`,
    });

  return (
    <Card p={0}>
      <div className="flex items-center gap-4 px-3 py-2 text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {previousOneOnOne ? (
            renderOneOnOneLink(previousOneOnOne, "previous")
          ) : null}
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-xs text-[var(--text-muted)]">←→</span>
          <Button icon="plus" onClick={handleCreateMeeting}>
            New 1-1
          </Button>
          <span className="text-xs text-[var(--text-muted)]">←→</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {nextOneOnOne ? (
            renderOneOnOneLink(nextOneOnOne, "next")
          ) : null}
        </div>
      </div>
    </Card>
  );
};

export default MeetingNavigationLinks;

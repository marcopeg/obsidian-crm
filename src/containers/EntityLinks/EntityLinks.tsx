import { useEntityFile } from "@/context/EntityFileProvider";
import { InlineError } from "@/components/InlineError";
import { CRM_ENTITIES, isCRMEntityType } from "@/entities";
import type { TCachedFile } from "@/types/TCachedFile";
import type { CRMEntityLinkConfig } from "@/types/CRMEntityConfig";
import { Stack } from "@/components/ui/Stack";
import { TeammatesLinks } from "./panels/TeammatesLinks";
import { TeamMembersLinks } from "./panels/TeamMembersLinks";
import { MeetingsLinks } from "./panels/MeetingsLinks";
import { TeamsLinks } from "./panels/TeamsLinks";
import { EmployeesLinks } from "./panels/EmployeesLinks";
import { ProjectsLinks } from "./panels/ProjectsLinks";
import { ParticipantTasksLinks } from "./panels/ParticipantTasksLinks";
import { RolePeopleLinks } from "./panels/RolePeopleLinks";
import { RoleTasksLinks } from "./panels/RoleTasksLinks";
import { ParticipantsAssignmentLinks } from "./panels/ParticipantsAssignmentLinks";
import { FactsLinks } from "./panels/FactsLinks";
import { LocationPeopleLinks } from "./panels/LocationPeopleLinks";
import { LocationCompaniesLinks } from "./panels/LocationCompaniesLinks";
import { MeetingNavigationLinks } from "./panels/MeetingNavigationLinks";

type LinkPanelProps = {
  file: TCachedFile;
  config: Record<string, unknown>;
};

const entityMap: Record<string, React.ComponentType<LinkPanelProps>> = {
  teammates: TeammatesLinks,
  "team-members": TeamMembersLinks,
  meetings: MeetingsLinks,
  "meeting-navigation": MeetingNavigationLinks,
  teams: TeamsLinks,
  employees: EmployeesLinks,
  projects: ProjectsLinks,
  "participant-tasks": ParticipantTasksLinks,
  "role-people": RolePeopleLinks,
  "role-tasks": RoleTasksLinks,
  "participants-assignment": ParticipantsAssignmentLinks,
  facts: FactsLinks,
  "location-people": LocationPeopleLinks,
  "location-companies": LocationCompaniesLinks,
};

const renderMissingConfigError = (message: string, key?: React.Key) => (
  <InlineError key={key} message={`EntityLinks: ${message}`} />
);

export const EntityLinks = () => {
  const { file } = useEntityFile();
  if (!file) {
    return null;
  }

  const frontmatter = file.cache?.frontmatter;
  if (!frontmatter) {
    return null;
  }

  const rawEntityType = frontmatter?.type;
  if (!rawEntityType) {
    return renderMissingConfigError(
      "current file is missing a frontmatter type"
    );
  }

  const entityType = String(rawEntityType).trim().toLowerCase();

  if (!isCRMEntityType(entityType)) {
    return renderMissingConfigError(`unknown entity type "${entityType}"`);
  }

  const entityConfig = CRM_ENTITIES[entityType];

  const baseLinkConfigs = (entityConfig.links ?? []) as CRMEntityLinkConfig[];
  const hasParticipantTasksLink = baseLinkConfigs.some(
    (config) => config.type === "participant-tasks"
  );

  const linkConfigs = hasParticipantTasksLink
    ? baseLinkConfigs
    : [...baseLinkConfigs, { type: "participant-tasks" }];

  if (linkConfigs.length === 0) {
    return renderMissingConfigError(
      `no link configuration defined for "${entityType}"`
    );
  }

  return (
    <Stack direction="column" gap={2}>
      {linkConfigs.map((linkConfig, index) => {
        const Component = entityMap[linkConfig.type];
        if (!Component) {
          return renderMissingConfigError(
            `no renderer registered for link type "${linkConfig.type}"`,
            `${linkConfig.type}-${index}`
          );
        }

        const { type, ...panelConfig } = linkConfig;
        return (
          <Component
            key={`${type}-${index}`}
            file={file}
            config={panelConfig}
          />
        );
      })}
    </Stack>
  );
};

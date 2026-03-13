import type { EnvironmentInfo } from './collect-env.js';

export type IssueType = 'bug' | 'feature' | 'question';

export interface BugDetails {
  type: 'bug';
  title: string;
  description: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
}

export interface FeatureDetails {
  type: 'feature';
  title: string;
  description: string;
  useCase: string;
}

export interface QuestionDetails {
  type: 'question';
  title: string;
  description: string;
}

export type IssueDetails = BugDetails | FeatureDetails | QuestionDetails;

export interface ContactInfo {
  email?: string;
  name?: string;
}

function formatEnvironment(env: EnvironmentInfo): string {
  const lines = [
    `- **Node.js:** ${env.nodeVersion}`,
    `- **Platform:** ${env.platform} (${env.arch})`,
  ];

  const pkgEntries = Object.entries(env.packages);
  if (pkgEntries.length > 0) {
    lines.push('- **Packages:**');
    for (const [name, version] of pkgEntries) {
      lines.push(`  - \`${name}\`: ${version}`);
    }
  }

  return lines.join('\n');
}

function environmentSection(env: EnvironmentInfo | null): string {
  if (!env) return '';

  return `
<details>
<summary>Environment</summary>

${formatEnvironment(env)}

</details>`;
}

function contactSection(contact: ContactInfo | null): string {
  if (!contact) return '';

  const lines: string[] = [];
  if (contact.name) lines.push(`- **Name:** ${contact.name}`);
  if (contact.email) lines.push(`- **Email:** ${contact.email}`);

  if (lines.length === 0) return '';

  return `

## Contact

${lines.join('\n')}`;
}

export function buildBugBody(
  details: BugDetails,
  env: EnvironmentInfo | null,
  contact: ContactInfo | null,
): string {
  return `## Description

${details.description}

## Steps to Reproduce

${details.stepsToReproduce}

## Expected Behavior

${details.expectedBehavior}

## Actual Behavior

${details.actualBehavior}
${environmentSection(env)}${contactSection(contact)}`;
}

export function buildFeatureBody(
  details: FeatureDetails,
  env: EnvironmentInfo | null,
  contact: ContactInfo | null,
): string {
  return `## Description

${details.description}

## Use Case

${details.useCase}
${environmentSection(env)}${contactSection(contact)}`;
}

export function buildQuestionBody(
  details: QuestionDetails,
  env: EnvironmentInfo | null,
  contact: ContactInfo | null,
): string {
  return `## Description

${details.description}
${environmentSection(env)}${contactSection(contact)}`;
}

export function buildBody(
  details: IssueDetails,
  env: EnvironmentInfo | null,
  contact: ContactInfo | null,
): string {
  switch (details.type) {
    case 'bug':
      return buildBugBody(details, env, contact);
    case 'feature':
      return buildFeatureBody(details, env, contact);
    case 'question':
      return buildQuestionBody(details, env, contact);
  }
}

import newGithubIssueUrl from 'new-github-issue-url';
import type { IssueType } from './templates.js';

const LABEL_MAP: Record<IssueType, string> = {
  bug: 'bug',
  feature: 'enhancement',
  question: 'question',
};

const MAX_URL_LENGTH = 7500;

const TRUNCATION_NOTICE = '\n\n---\n*Environment info truncated due to URL length limits. Please add manually if needed.*';

export function buildIssueUrl(
  type: IssueType,
  title: string,
  body: string,
): string {
  let finalBody = body;

  const testUrl = newGithubIssueUrl({
    user: 'mikemainguy',
    repo: 'rapierphysicsplugin',
    title,
    body: finalBody,
    labels: [LABEL_MAP[type]],
  });

  if (testUrl.length > MAX_URL_LENGTH) {
    const detailsStart = finalBody.indexOf('<details>');
    const detailsEnd = finalBody.indexOf('</details>');

    if (detailsStart !== -1 && detailsEnd !== -1) {
      finalBody =
        finalBody.substring(0, detailsStart) +
        TRUNCATION_NOTICE +
        finalBody.substring(detailsEnd + '</details>'.length);
    }
  }

  return newGithubIssueUrl({
    user: 'mikemainguy',
    repo: 'rapierphysicsplugin',
    title,
    body: finalBody,
    labels: [LABEL_MAP[type]],
  });
}

import { describe, it, expect } from 'vitest';
import { buildIssueUrl } from '../build-url.js';

describe('buildIssueUrl', () => {
  it('should create a URL for bug reports with bug label', () => {
    const url = buildIssueUrl('bug', 'Test Bug', 'Bug body');

    expect(url).toContain('github.com/mikemainguy/rapierphysicsplugin/issues/new');
    expect(url).toContain('Test+Bug');
    expect(url).toContain('labels=bug');
  });

  it('should create a URL for feature requests with enhancement label', () => {
    const url = buildIssueUrl('feature', 'New Feature', 'Feature body');

    expect(url).toContain('github.com/mikemainguy/rapierphysicsplugin/issues/new');
    expect(url).toContain('labels=enhancement');
  });

  it('should create a URL for questions with question label', () => {
    const url = buildIssueUrl('question', 'How to X?', 'Question body');

    expect(url).toContain('labels=question');
  });

  it('should encode special characters in title and body', () => {
    const url = buildIssueUrl('bug', 'Bug & error <script>', 'Body with & and =');

    expect(url).not.toContain('<script>');
    expect(url).toContain('%3Cscript%3E');
  });

  it('should truncate environment section when URL is too long', () => {
    const longEnv = '<details>\n' + 'x'.repeat(8000) + '\n</details>';
    const body = `## Description\n\nTest\n\n${longEnv}\n\n## Extra`;

    const url = buildIssueUrl('bug', 'Test', body);

    expect(url.length).toBeLessThan(10000);
    expect(url).toContain('truncated');
  });

  it('should not truncate short URLs', () => {
    const body = '<details>\nShort env\n</details>';
    const url = buildIssueUrl('bug', 'Test', body);

    expect(url).not.toContain('truncated');
  });
});
